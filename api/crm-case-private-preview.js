"use strict";
// One-shot, cron-authenticated private preview. Never targets the group chat.
const crypto = require("crypto");
const { get, put } = require("@vercel/blob");
const feishu = require("../lib/crm-feishu");
const TABLE = "tblNi7C5q5FYlG06";
const CHAT = "oc_45c79d089b461677fe06caf55e375dec";
const MARKER = "crm-cases/v1/private-report-preview-20261108.json";
const VIEW = "https://ycnic6l8vkfx.feishu.cn/wiki/OSUew3QCUics0vkuphJc2sDfnGf?table=tblNi7C5q5FYlG06&view=vewS88etSM";

function authorized(req) {
  const secret = Buffer.from(process.env.CRON_SECRET || "");
  const incoming = Buffer.from(String(req.headers.authorization || "").replace(/^Bearer\s+/i, ""));
  return secret.length > 0 && secret.length === incoming.length && crypto.timingSafeEqual(secret, incoming);
}
function value(v) {
  if (v == null) return "";
  if (Array.isArray(v)) return v.map(value).join(" ");
  if (typeof v === "object") return value(v.text ?? v.name ?? v.value ?? "");
  return String(v);
}
async function fetchCases(token) {
  const out = [];
  let page;
  for (let i = 0; i < 20; i++) {
    const params = new URLSearchParams({ page_size: "500" });
    if (page) params.set("page_token", page);
    const data = await feishu.request(token, `/bitable/v1/apps/Y7VvbgreAasoLtsYdhrcmmDUn5d/tables/${TABLE}/records?${params}`);
    out.push(...(data.items || []).filter(r => value(r.fields?.["数据来源ID"]).startsWith("case:")));
    if (!data.has_more || !data.page_token) break;
    page = data.page_token;
  }
  return out;
}
function report(rows, date = new Date()) {
  const totals = { urgent: 0, high: 0, normal: 0, replied: 0, noReply: 0, resolved: 0, unverified: 0 };
  const categories = new Map();
  const alerts = [];
  for (const row of rows) {
    const f = row.fields || {};
    const p = value(f["任务优先级"]), s = value(f["任务状态"]), reply = value(f["客服回复状态"]);
    const kind = value(f["问题类别"]) || "未分类";
    categories.set(kind, (categories.get(kind) || 0) + 1);
    if (p === "紧急") totals.urgent++; else if (p === "高") totals.high++; else totals.normal++;
    if (/已解决|已完成/.test(s) && !/未解决/.test(s)) totals.resolved++;
    else if (/已回复/.test(reply)) totals.replied++;
    else if (/未发现后续客服回复/.test(reply)) totals.noReply++;
    else totals.unverified++;
    if ((p === "紧急" || p === "高") && !/已解决|已完成|已取消/.test(s)) {
      alerts.push({ weight: p === "紧急" ? 0 : 1, name: value(f["客户姓名"]) || value(f["客户邮箱"]) || "未知客户", order: value(f["关联订单号"]), kind, reply, p });
    }
  }
  alerts.sort((a, b) => a.weight - b.weight);
  const dateText = date.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
  return [
    "【Kailash Energy｜客服 Case 私聊验收日报】",
    `数据读取时间：${dateText}（北京时间）`,
    `当前表内 Case：${rows.length} 件（历史及近期混合，非今日新增）`,
    `优先级：🔴紧急 ${totals.urgent}｜🟠高 ${totals.high}｜普通 ${totals.normal}`,
    `状态：已解决/已完成 ${totals.resolved}｜已回复但未确认解决 ${totals.replied}｜未发现后续回复 ${totals.noReply}｜待核验 ${totals.unverified}`,
    "问题类别：" + ([...categories.entries()].sort((a,b)=>b[1]-a[1]).map(([k,n])=>`${k} ${n}`).join("；") || "暂无"),
    "—— 优先处理（最多 5 件）——",
    ...(alerts.slice(0, 5).map((a, i) => `${i+1}. ${a.p}｜${a.name}${a.order ? `｜#${a.order}` : ""}｜${a.kind}｜${a.reply || "回复待核验"}`)),
    ...(alerts.length ? [] : ["暂无未完成的高优先级 Case（以表格状态为准）"]),
    "注意：客服已回复 ≠ 客户问题已解决；解决状态需有客户确认或人工处理凭据。",
    "本次为私聊测试，不向日报群发送。",
    "原始记录与处理视图：" + VIEW,
  ].join("\n");
}
async function alreadySent() {
  const response = await get(MARKER, { access: "private", useCache: false });
  return response?.statusCode === 200;
}
async function send(token, message) {
  const data = await feishu.request(token, "/im/v1/messages?receive_id_type=chat_id", "POST", {
    receive_id: CHAT, msg_type: "text", content: JSON.stringify({ text: message }),
    uuid: crypto.createHash("sha256").update(MARKER).digest("hex").slice(0, 32),
  });
  if (!data.message_id) throw Error("Feishu did not return message_id");
  return data.message_id;
}
module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") return res.status(405).json({ ok:false });
  if (!authorized(req)) return res.status(401).json({ ok:false });
  if (!process.env.BLOB_READ_WRITE_TOKEN) return res.status(200).json({ ok:true, skipped:"not_primary_crm_project" });
  try {
    if (await alreadySent()) return res.status(200).json({ ok:true, skipped:"already_sent" });
    const token = await feishu.tenantToken();
    const rows = await fetchCases(token);
    const messageId = await send(token, report(rows));
    await put(MARKER, JSON.stringify({ at:new Date().toISOString(), messageId, count:rows.length }), {
      access:"private", addRandomSuffix:false, allowOverwrite:true, contentType:"application/json",
    });
    return res.status(200).json({ ok:true, sent:true, caseCount:rows.length, private:true });
  } catch (error) {
    console.error("[crm-case-private-preview]", String(error.message).slice(0, 180));
    return res.status(502).json({ ok:false, retryable:true });
  }
};
module.exports.report = report;
