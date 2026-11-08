"use strict";
const crypto = require("crypto");
const gmail = require("../lib/crm-gmail");

const MAX_RESULTS = 30;
const MAX_SCAN = 100;
const WINDOW_MS = 60_000;

function authorized(req, now = Date.now()) {
  const secret = process.env.FEISHU_APP_SECRET;
  const timestamp = String(req.headers["x-kailash-timestamp"] || "");
  const signature = String(req.headers["x-kailash-signature"] || "");
  const limit = String(req.query?.limit || "10");
  if (!secret || !/^\d{13}$/.test(timestamp) || !/^sha256=[a-f0-9]{64}$/.test(signature)) return false;
  if (Math.abs(now - Number(timestamp)) > WINDOW_MS) return false;
  const payload = `${timestamp}\n/api/crm-gmail-bridge\n${limit}`;
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

function issue(subject, body) {
  const value = `${subject || ""} ${body || ""}`.toLowerCase();
  if (/not received|did not receive|never received|haven't received|hasn't arrived|not arrived|missing package|lost parcel|lost package|order not received|未收到|未送达|丢件/.test(value)) return {category:"未收到货",priority:"P0",summary:"客户反馈未收到订单，需要核实物流轨迹、签收凭据及收货地址。"};
  if (/chargeback|fraud|unauthorized charge|被盗刷|欺诈/.test(value)) return {category:"支付争议",priority:"P0",summary:"客户提出支付或扣款争议，需要优先核对交易。"};
  if (/refund|return|cancel|退款|退货|取消订单/.test(value)) return {category:"退款退货",priority:"P0",summary:"客户提出退款、退货或取消诉求，需要核对订单状态与售后政策。"};
  if (/damaged|broken|defect|wrong item|wrong product|破损|损坏|发错/.test(value)) return {category:"商品售后",priority:"P0",summary:"客户反馈商品损坏、瑕疵或错发，需要核对照片与订单。"};
  if (/where is|tracking|delivery|shipping|shipped|arriv|post office|parcel|package|物流|快递|发货|多久到/.test(value)) return {category:"物流询单",priority:"P1",summary:"客户询问物流状态或反馈邮局信息，需要查询最新物流。"};
  if (/address|size|exchange|modify|change my order|地址|尺寸|换货|修改订单/.test(value)) return {category:"订单修改",priority:"P1",summary:"客户申请修改地址、尺寸或订单信息，需要核对履约进度。"};
  if (/order|purchase|payment|invoice|discount|coupon|付款|发票|优惠码|订单/.test(value)) return {category:"订单咨询",priority:"P1",summary:"客户咨询订单或购买事宜，需要结合订单记录回复。"};
  return {category:"其他客户咨询",priority:"P2",summary:"客户主动来信，需人工阅读正文并确认下一步处理。"};
}
function priority(subject, snippet){return issue(subject,snippet).priority;}

async function gather(limit) {
  const token = await gmail.token();
  const result = await gmail.listMessages(token, {
    maxResults: MAX_SCAN,
    after: new Date(Date.now() - 30 * 86400000).toISOString(),
    query: "in:inbox is:unread",
  });
  const accepted = [];
  const rejected = {};
  const threads = new Set();
  const messageRows = result.messages || [];
  for (let i = 0; i < messageRows.length; i += 10) {
    const batch = await Promise.allSettled(messageRows.slice(i, i + 10).map((row) => gmail.message(token, row.id)));
    for (const settled of batch) {
    if (settled.status !== "fulfilled") {
      rejected.fetch_error = (rejected.fetch_error || 0) + 1;
      continue;
    }
    const msg = settled.value;
    const reason = gmail.classifyMessage(msg);
    if (reason !== "candidate") {
      rejected[reason] = (rejected[reason] || 0) + 1;
      continue;
    }
    if (threads.has(msg.threadId)) continue;
    threads.add(msg.threadId);
    const info = gmail.compactMessage(msg);
    const original = gmail.messageBody(msg);
    const classification = issue(info.subject, original);
    accepted.push({
      threadId: info.threadId, from: info.from, subject: info.subject,
      date: info.date, original, snippet: String(msg.snippet || "").slice(0, 220),
      ...classification,
    });
    }
  }
  accepted.sort((a, b) => ({ P0: 0, P1: 1, P2: 2 })[a.priority] - ({ P0: 0, P1: 1, P2: 2 })[b.priority] || b.date.localeCompare(a.date));
  return {
    source: "Gmail", mailbox: "service@kailashenergy.com",
    criteria: "最近30天收件箱未读邮件；过滤系统通知、营销与机器人；仅为待核验候选，并非全部待办或未回复总数",
    scanned: messageRows.length, hasMore: !!result.nextPageToken,
    candidateCountWithinScan: accepted.length, excludedWithinScan: rejected,
    returned: Math.min(accepted.length, limit), messages: accepted.slice(0, limit),
    observedAt: new Date().toISOString(),
  };
}

async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  if (req.method !== "GET") return res.status(405).json({ ok: false });
  if (!authorized(req)) return res.status(401).json({ ok: false });
  const raw = String(req.query?.limit || "10");
  if (!/^\d{1,2}$/.test(raw) || Number(raw) < 1 || Number(raw) > MAX_RESULTS) return res.status(400).json({ ok: false });
  try {
    return res.status(200).json({ ok: true, ...(await gather(Number(raw))) });
  } catch (e) {
    console.error("[crm-gmail-bridge] failed", String(e.message || e).replace(/[\r\n]/g, " ").slice(0, 80));
    return res.status(502).json({ ok: false, error: "gmail_backend_unavailable" });
  }
}

module.exports = handler;
module.exports.authorized = authorized;
module.exports.priority = priority;
module.exports.issue = issue;
