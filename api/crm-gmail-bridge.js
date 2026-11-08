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

function priority(subject, snippet) {
  const value = `${subject || ""} ${snippet || ""}`.toLowerCase();
  if (/refund|chargeback|fraud|cancel|return|damaged|broken|wrong item|not received|did not receive|missing|lost package|complaint|退款|退货|未收到|破损|投诉/.test(value)) return "P0";
  if (/where is|delivery|shipping|tracking|order|address|size|exchange|arrive|发货|物流|地址|尺寸|换货/.test(value)) return "P1";
  return "P2";
}

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
    accepted.push({
      threadId: info.threadId, from: info.from, subject: info.subject,
      date: info.date, snippet: String(msg.snippet || "").slice(0, 220),
      priority: priority(info.subject, msg.snippet),
    });
    }
  }
  accepted.sort((a, b) => ({ P0: 0, P1: 1, P2: 2 })[a.priority] - ({ P0: 0, P1: 1, P2: 2 })[b.priority] || b.date.localeCompare(a.date));
  return {
    source: "Gmail", mailbox: "service@kailashenergy.com",
    criteria: "最近30天收件箱未读邮件；过滤广告和自动通知；仅为候选待办，未核实是否已回复",
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
