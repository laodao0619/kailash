"use strict";
// Cases share the approved CRM communications table; human-owned fields are immutable.
const feishu = require("./crm-feishu");
const { adaptFields } = require("./crm-case-field-adapter");
const BASE = "Y7VvbgreAasoLtsYdhrcmmDUn5d";
const TABLE = "tblNi7C5q5FYlG06";
const NAME = "客户沟通与跟进";
const EXTRA = [
  {field_name:"Case ID",type:1},
  {field_name:"关联邮箱",type:1},
  {field_name:"客户原文摘录",type:1},
  {field_name:"客服回复状态",type:1},
  {field_name:"邮件数量",type:2},
  {field_name:"CRM等级（Case核验）",type:4},
];
const HUMAN = new Set(["负责人", "任务状态", "处理结果", "截止日期", "下次联系日期", "处理时长小时"]);
const issueCategory = category => {
  if (/物流|未收到|丢失|签收/.test(category)) return "物流查询";
  if (/尺寸|产品|质量|破损/.test(category)) return "产品问题";
  if (/退款|退货/.test(category)) return "退款退货";
  if (/赠品|补发/.test(category)) return "补发赠品";
  if (/修改|订单/.test(category)) return "售前咨询";
  return "其他";
};
const priority = text => /^(?:P0|紧急)$/i.test(text) ? "紧急" : /^(?:P1|优先|高)$/i.test(text) ? "高" : "普通";

async function ensureTable(token, { includeSchema = false } = {}) {
  const path = `/bitable/v1/apps/${BASE}/tables/${TABLE}`;
  const listing = await feishu.request(token, `/bitable/v1/apps/${BASE}/tables?page_size=100`);
  if (listing.has_more) throw Error("Feishu table listing incomplete; refusing Case schema changes");
  if (!Array.isArray(listing.items)) throw Error("Feishu table listing unavailable");
  const existing = listing.items.find(t => t.table_id === TABLE);
  if (!existing || existing.name !== NAME) throw Error("Approved CRM communication table missing or renamed");
  const fields = await feishu.request(token, path + "/fields?page_size=100");
  if (fields.has_more) throw Error("Feishu field schema incomplete; refusing Case schema changes");
  if (!Array.isArray(fields.items)) throw Error("Feishu field schema unavailable");
  const byName = new Map(fields.items.map(f => [f.field_name, f]));
  // The scheduled Case writer must never mutate the approved Feishu table schema.
  // Missing or altered fields require explicit administrator review, not auto-creation.
  for (const expected of EXTRA) {
    const actual = byName.get(expected.field_name);
    if (!actual) throw Error("Required Case field missing: " + expected.field_name);
    if (Number(actual.type) !== expected.type) {
      throw Error("Case field type mismatch: " + expected.field_name);
    }
  }
  return includeSchema ? { tableId: TABLE, schema: fields.items } : TABLE;
}

function recordFields(c, now = Date.now()) {
  const received = Date.parse(c.receivedAt || "");
  const gmailLink = String(c.originalUrl || "");
  return {
    "沟通记录编号": "case:" + String(c.caseId || ""),
    "数据来源ID": "case:" + String(c.caseId || ""),
    "Case ID": String(c.caseId || ""),
    "客户姓名": String(c.customerName || ""),
    "客户邮箱": String(c.customerEmail || ""),
    "关联邮箱": (c.emails || []).join(", "),
    "关联订单号": String(c.orderNumber || ""),
    "CRM等级（Case核验）": c.crmVerified ? String(c.crmGrade) : "待核验",
    "问题类别": issueCategory(String(c.category || "")),
    "任务优先级": priority(String(c.priority || "")),
    "沟通渠道": "Gmail",
    "沟通方向": "客户发起",
    "邮件主题": String(c.subject || ""),
    "沟通摘要": String(c.summary || ""),
    "客户原文摘录": String(c.originalExcerpt || "").slice(0, 1800),
    "客服回复状态": String(c.replyStatus || "待核验"),
    "邮件数量": Number(c.messageCount) || 1,
    ...(Number.isFinite(received) ? { "记录时间": received } : {}),
    ...(gmailLink.startsWith("https://mail.google.com/") ? { "原邮件链接": {text:"查看 Gmail",link:gmailLink} } : {}),
    "下一步行动": String(c.nextAction || ""),
    "是否需要人工处理": true,
    "最后同步时间": now,
  };
}

// Preflight the entire Case batch against one fresh Feishu schema before a
// scheduled run writes even its first row. Include create-only task status,
// since the writer cannot know which rows will be inserted until lookup.
// This is validation only: no Feishu reads/writes, customer data, or cursors.
function preflightCaseBatch(batch, schema) {
  if (!Array.isArray(batch)) throw Error("Case batch unavailable");
  for (const c of batch) {
    if (!/^CASE-[0-9A-F]{12}$/.test(c?.caseId || "")) throw Error("Invalid Case ID");
    adaptFields({ ...recordFields(c), "任务状态": "待处理" }, schema);
  }
  return batch.length;
}

async function upsertCase(token, tableId, c, verifiedSchema = null) {
  if (tableId !== TABLE) throw Error("Refusing write outside approved communication table");
  if (!/^CASE-[0-9A-F]{12}$/.test(c.caseId || "")) throw Error("Invalid Case ID");
  const records = await feishu.findBy(token, TABLE, "数据来源ID", "case:" + c.caseId);
  if (records.length > 1) throw Error("Duplicate Case ID in Feishu");
  const path = `/bitable/v1/apps/${BASE}/tables/${TABLE}/records`;
  // Reuse the schema verified by ensureTable within this one cron invocation.
  // Direct callers still fetch a fresh schema, never a cross-invocation cache.
  const schemaResponse = verifiedSchema == null
    ? await feishu.request(token, `/bitable/v1/apps/${BASE}/tables/${TABLE}/fields?page_size=100`)
    : { items: verifiedSchema, has_more: false };
  if (schemaResponse.has_more) throw Error("Feishu field schema exceeds one page; refusing unsafe Case write");
  const fields = adaptFields(recordFields(c), schemaResponse.items);
  if (records.length) {
    await feishu.request(token, path + "/" + records[0].record_id, "PUT", { fields });
    return "updated";
  }
  await feishu.request(token, path, "POST", { fields: adaptFields({...recordFields(c), "任务状态":"待处理"}, schemaResponse.items) });
  return "created";
}

module.exports = { NAME, TABLE, EXTRA, HUMAN, ensureTable, recordFields, preflightCaseBatch, upsertCase };
