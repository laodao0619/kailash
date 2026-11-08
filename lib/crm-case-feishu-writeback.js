"use strict";

// A separate operational table inside the existing Kailash CRM Base.
// Never overwrite human-entered owner, status, solution or close notes.
const feishu = require("./crm-feishu");
const BASE = "Y7VvbgreAasoLtsYdhrcmmDUn5d";
const NAME = "客户Case跟进";
const FIELDS = [
  "Case ID", "客户姓名", "客户邮箱", "关联邮箱", "订单编号",
  "CRM等级", "客户问题分类", "紧急度", "邮件主题",
  "问题摘要", "客户原文摘录", "客服回复状态", "邮件数量",
  "最后来信时间", "Gmail原文", "建议处理方案",
  "负责人", "处理状态", "实际处理方案", "完成时间", "VOC标签", "最后同步时间",
];
const HUMAN = new Set(["负责人", "处理状态", "实际处理方案", "完成时间", "VOC标签"]);
const initial = FIELDS.map(field_name => ({
  field_name, type: ["邮件数量"].includes(field_name) ? 2
    : ["最后来信时间", "完成时间", "最后同步时间"].includes(field_name) ? 5 : 1,
}));

async function ensureTable(token) {
  const path = `/bitable/v1/apps/${BASE}/tables`;
  let pageToken;
  do {
    const suffix = pageToken ? `?page_size=100&page_token=${encodeURIComponent(pageToken)}` : "?page_size=100";
    const data = await feishu.request(token, path + suffix);
    const match = (data.items || []).find(table => table.name === NAME);
    if (match) return match.table_id;
    pageToken = data.has_more ? data.page_token : null;
  } while (pageToken);
  const created = await feishu.request(token, path, "POST", {
    table: { name: NAME, default_view_name: "全部Case", fields: initial },
  });
  if (!created.table_id && !created.table?.table_id) throw Error("Feishu Case table creation missing ID");
  return created.table_id || created.table.table_id;
}

function recordFields(c, now = Date.now()) {
  const received = Date.parse(c.receivedAt || "");
  return {
    "Case ID": String(c.caseId || ""),
    "客户姓名": String(c.customerName || ""),
    "客户邮箱": String(c.customerEmail || ""),
    "关联邮箱": (c.emails || []).join(", "),
    "订单编号": String(c.orderNumber || ""),
    "CRM等级": c.crmVerified ? String(c.crmGrade) : "待核验",
    "客户问题分类": String(c.category || ""),
    "紧急度": String(c.priority || ""),
    "邮件主题": String(c.subject || ""),
    "问题摘要": String(c.summary || ""),
    "客户原文摘录": String(c.originalExcerpt || "").slice(0, 1800),
    "客服回复状态": String(c.replyStatus || "待核验"),
    "邮件数量": Number(c.messageCount) || 1,
    ...(Number.isFinite(received) ? { "最后来信时间": received } : {}),
    "Gmail原文": String(c.originalUrl || ""),
    "建议处理方案": String(c.nextAction || ""),
    "最后同步时间": now,
  };
}

async function upsertCase(token, tableId, c) {
  if (!/^CASE-[0-9A-F]{12}$/.test(c.caseId || "")) throw Error("Invalid Case ID");
  const records = await feishu.findBy(token, tableId, "Case ID", c.caseId);
  if (records.length > 1) throw Error("Duplicate Case ID in Feishu");
  const path = `/bitable/v1/apps/${BASE}/tables/${tableId}/records`;
  const fields = recordFields(c);
  if (records.length) {
    // Only machine-owned columns. Existing human notes remain untouched.
    await feishu.request(token, path + "/" + records[0].record_id, "PUT", { fields });
    return "updated";
  }
  await feishu.request(token, path, "POST", {
    fields: { ...fields, "处理状态": "待分配" },
  });
  return "created";
}

module.exports = { NAME, FIELDS, HUMAN, ensureTable, recordFields, upsertCase };
