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
  // Existing production tables may retain the historical text type (1).
  // Single- and multi-select variants are also supported via the live schema.
  {field_name:"CRM等级（Case核验）",type:1},
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

// Read only Feishu schema metadata, never Case rows. A >100-field Bitable must
// not be mistaken for a missing field because the first page was truncated.
// Bound pagination and reject malformed/cyclic cursors rather than accepting
// partial schemas or scanning indefinitely.
async function completeSchemaPages(token, endpoint, label) {
  const items = [];
  const seen = new Set();
  let cursor = null;
  for (let page = 0; page < 5; page++) {
    const url = endpoint + "?page_size=100" +
      (cursor ? "&page_token=" + encodeURIComponent(cursor) : "");
    const response = await feishu.request(token, url);
    if (!Array.isArray(response?.items)) {
      throw Error("Feishu " + label + " unavailable");
    }
    // A missing or malformed pagination flag does NOT prove this is the last
    // page. Accepting it could silently omit Feishu fields, then validate or
    // upsert against an incomplete schema. Fail closed before any Case writes.
    if (typeof response.has_more !== "boolean") {
      throw Error("Feishu " + label + " pagination flag invalid");
    }
    items.push(...response.items);
    if (response.has_more === false) {
      return items;
    }
    const next = response.page_token;
    if (typeof next !== "string" || !next.trim() || seen.has(next)) {
      throw Error("Feishu " + label + " pagination invalid");
    }
    seen.add(next);
    cursor = next;
  }
  throw Error("Feishu " + label + " pagination exceeds safety limit");
}
async function ensureTable(token, { includeSchema = false } = {}) {
  const path = `/bitable/v1/apps/${BASE}/tables/${TABLE}`;
  const listing = await completeSchemaPages(token, `/bitable/v1/apps/${BASE}/tables`, "table listing");
  const existing = listing.find(t => t.table_id === TABLE);
  if (!existing || existing.name !== NAME) throw Error("Approved CRM communication table missing or renamed");
  const fieldItems = await completeSchemaPages(token, path + "/fields", "field schema");
  const byName = new Map(fieldItems.map(f => [f.field_name, f]));
  // The scheduled Case writer must never mutate the approved Feishu table schema.
  // Missing or altered fields require explicit administrator review, not auto-creation.
  for (const expected of EXTRA) {
    const actual = byName.get(expected.field_name);
    if (!actual) throw Error("Required Case field missing: " + expected.field_name);
    // The Case verification grade was historically a text column. Existing
    // text (1), single-select (3), and multi-select (4) variants are valid.
    // Preserve the real schema; never auto-migrate or write unreviewed grades.
    const compatible = expected.field_name === "CRM等级（Case核验）"
      ? [1, 3, 4].includes(Number(actual.type))
      : Number(actual.type) === expected.type;
    if (!compatible) {
      throw Error("Case field type mismatch: " + expected.field_name);
    }
  }
  return includeSchema ? { tableId: TABLE, schema: fieldItems } : TABLE;
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
    // Historical event grades are unaudited. Validate only the pending option;
    // updates omit this field, creates initialize it to pending.
    "CRM等级（Case核验）": "待核验",
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

// A Case sync may update only system-owned fields. Feishu documents a sparse
// PUT as updating supplied fields while retaining omitted fields; a PATCH is
// not part of the published single-record Bitable API. Keep the payload
// partial and fail closed if later edits introduce human-owned keys.
function assertNoHumanFields(fields, { initialCreate = false } = {}) {
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) {
    throw Error("Invalid Case write fields");
  }
  for (const [name, value] of Object.entries(fields)) {
    if (HUMAN.has(name) &&
        !(initialCreate && name === "任务状态" && value === "待处理")) {
      throw Error("Refusing Case write to human-owned field: " + name);
    }
  }
  return fields;
}

// Preflight the entire Case batch against one fresh Feishu schema before a
// scheduled run writes even its first row. Include create-only task status,
// since the writer cannot know which rows will be inserted until lookup.
// This is validation only: no Feishu reads/writes, customer data, or cursors.
function preflightCaseBatch(batch, schema) {
  if (!Array.isArray(batch)) throw Error("Case batch unavailable");
  const caseIds = new Set();
  for (const c of batch) {
    if (!/^CASE-[0-9A-F]{12}$/.test(c?.caseId || "")) throw Error("Invalid Case ID");
    if (caseIds.has(c.caseId)) throw Error("Duplicate Case ID in batch");
    caseIds.add(c.caseId);
    // Validate system-owned and create-only fields before the first write.
    // Any future accidental human-owned field in recordFields must reject the
    // entire batch, rather than failing after earlier Cases were written.
    const systemFields = assertNoHumanFields(recordFields(c));
    const createFields = assertNoHumanFields(
      { ...systemFields, "任务状态": "待处理" }, { initialCreate: true });
    adaptFields(createFields, schema);
  }
  return batch.length;
}

// Never treat a truncated or malformed Feishu identity search as "no Case".
 // A false negative would create duplicate Case records on retry.
async function findCaseRecords(token, caseId) {
  const records = await feishu.findBy(
    token, TABLE, "数据来源ID", "case:" + caseId, { requireComplete: true }
  );
  if (!Array.isArray(records)) throw Error("Feishu Case identity lookup incomplete");
  if (records.length > 1) throw Error("Duplicate Case ID in Feishu");
  if (records.some(row => typeof row?.record_id !== "string" || !row.record_id.trim())) {
    throw Error("Feishu Case identity record invalid");
  }
  return records;
}

async function upsertCase(token, tableId, c, verifiedSchema = null) {
  if (tableId !== TABLE) throw Error("Refusing write outside approved communication table");
  if (!/^CASE-[0-9A-F]{12}$/.test(c.caseId || "")) throw Error("Invalid Case ID");
  const records = await findCaseRecords(token, c.caseId);
  if (records.length > 1) throw Error("Duplicate Case ID in Feishu");
  const path = `/bitable/v1/apps/${BASE}/tables/${TABLE}/records`;
  // Reuse the schema verified by ensureTable within this one cron invocation.
  // Direct callers still fetch a fresh schema, never a cross-invocation cache.
  const schema = verifiedSchema == null
    ? await completeSchemaPages(token, `/bitable/v1/apps/${BASE}/tables/${TABLE}/fields`, "field schema")
    : verifiedSchema;
  // Direct callers must use the same complete, bounded pagination and strict
  // has_more validation as the scheduled writer. Otherwise a truncated direct
  // lookup could be treated as a complete schema or reject legitimate tables.
  const fields = assertNoHumanFields(adaptFields(recordFields(c), schema));
  if (records.length) {
    // Case grade may have been reviewed manually or based on a newer audited
    // ledger. Never overwrite it from archived email events or old CRM cache.
    // Keep the Feishu schema check for the field, but omit it from sparse PUT.
    const updateFields = { ...fields };
    // These fields are initialized on first Case creation, then may be edited
    // by the support team. Subsequent Gmail syncs must not reopen a resolved
    // Case or replace an agent's next step with a stale generated suggestion.
    // Omitting them from Feishu's sparse PUT preserves the existing values.
    for (const name of ["CRM等级（Case核验）", "是否需要人工处理", "下一步行动"]) {
      delete updateFields[name];
    }
    await feishu.request(token, path + "/" + records[0].record_id, "PUT", { fields: updateFields });
    return "updated";
  }
  // New Cases are unverified until the independent full-history finance audit
  // and human review complete, regardless of stale event.crmVerified flags.
  const newFields = assertNoHumanFields(adaptFields({
    ...recordFields(c), "CRM等级（Case核验）":"待核验", "任务状态":"待处理"
  }, schema), { initialCreate: true });
  await feishu.request(token, path, "POST", { fields: newFields });
  return "created";
}

module.exports = { NAME, TABLE, EXTRA, HUMAN, ensureTable, recordFields, preflightCaseBatch, assertNoHumanFields, findCaseRecords, upsertCase };
