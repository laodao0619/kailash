"use strict";
const gmail = require("./crm-gmail");
const feishu = require("./crm-feishu");
const TABLE = "tblbk7Ju6fcM1BXF";
const GRADES = new Set(["S+", "S", "A", "B", "基础客户", "沉睡", "从未购买"]);

function fieldText(value) {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(v => fieldText(v?.text ?? v)).join("");
  return value && typeof value === "object" ? fieldText(value.text ?? "") : "";
}

function verifiedCustomer(records) {
  if (!Array.isArray(records) || records.length !== 1) return null;
  const f = records[0]?.fields || {};
  if (fieldText(f["客户数据状态"]) !== "有效") return null;
  const grade = fieldText(f["CRM等级"]);
  if (!GRADES.has(grade)) return null;
  return {
    shopifyCustomerId: fieldText(f["Shopify客户ID"]),
    customerName: fieldText(f["客户姓名"]),
    crmGrade: grade,
    crmVerified: true,
    m180: typeof f["近180天净消费"] === "number" ? f["近180天净消费"] : null,
    f180: typeof f["近180天有效订单数"] === "number" ? f["近180天有效订单数"] : null,
    rDays: typeof f["最近购买距今天数R"] === "number" ? f["最近购买距今天数R"] : null,
  };
}

function replyEvidence(thread, incomingMessage) {
  const received = Number(incomingMessage?.internalDate);
  if (!Number.isFinite(received)) return { replyVerified: false, replyStatus: "待核验" };
  const messages = thread?.messages || [];
  const laterServiceReplies = messages.filter(m => {
    const from = gmail.emailAddress(gmail.header(m, "From"));
    return ["service@kailashenergy.com", "support@kailashenergy.com"].includes(from)
      && Number(m.internalDate) > received;
  });
  if (laterServiceReplies.length) {
    return {
      replyVerified: true,
      replyStatus: "客服已回复（未确认解决）",
      latestReplyAt: new Date(Math.max(...laterServiceReplies.map(m => Number(m.internalDate)))).toISOString(),
    };
  }
  return { replyVerified: false, replyStatus: "未发现后续客服回复（需复核）" };
}

async function enrich(entry, message, gmailToken, feishuToken) {
  const [customer, conversation] = await Promise.allSettled([
    feishu.findBy(feishuToken, TABLE, "邮箱", entry.customerEmail),
    gmail.thread(gmailToken, entry.threadId),
  ]);
  const matched = customer.status === "fulfilled" ? verifiedCustomer(customer.value) : null;
  const replied = conversation.status === "fulfilled"
    ? replyEvidence(conversation.value, message)
    : { replyVerified: false, replyStatus: "待核验" };
  return {
    ...entry,
    ...(matched || { crmGrade: "待核验", crmVerified: false }),
    ...replied,
    identityStatus: matched ? "Shopify ID / CRM 唯一匹配" : "待核验",
  };
}

module.exports = { fieldText, verifiedCustomer, replyEvidence, enrich };
