"use strict";
const crypto = require("crypto");
const { get, put, list } = require("@vercel/blob");
const gmail = require("./crm-gmail");
const { issue } = require("../api/crm-gmail-bridge");

const PREFIX = "crm-cases/v1/events/";
const STATE = "crm-cases/v1/sync-state.json";
const DAYS = 30;

function authorized(req) {
  const expected = Buffer.from(process.env.CRON_SECRET || "");
  const received = Buffer.from(String(req.headers.authorization || "").replace(/^Bearer\s+/i, ""));
  return expected.length > 0 && expected.length === received.length && crypto.timingSafeEqual(expected, received);
}
async function read(path) {
  const response = await get(path, { access: "private", useCache: false });
  if (!response || response.statusCode !== 200) return null;
  const buffers = [];
  for await (const chunk of response.stream) buffers.push(chunk);
  return JSON.parse(Buffer.concat(buffers).toString("utf8"));
}
async function save(path, data) {
  return put(path, JSON.stringify(data), {
    access: "private", addRandomSuffix: false, allowOverwrite: true,
    contentType: "application/json",
  });
}
function orderNumber(value) {
  const m = String(value || "").match(/(?:order|commande|订单|réf(?:érence)?)[\s#:№-]*([0-9]{4,7})|#\s*([0-9]{4,7})/i);
  return m ? (m[1] || m[2]) : null;
}
function issueFamily(category) {
  if (["未收到货", "物流询单", "退回寄件人"].includes(category)) return "delivery";
  if (["尺寸售后", "商品售后"].includes(category)) return "product_aftercare";
  return category;
}
function canonicalCaseId(e) {
  if (!e.orderNumber) return e.caseId;
  return "CASE-" + crypto.createHash("sha256")
    .update(`order:${e.orderNumber}|${issueFamily(e.category)}`)
    .digest("hex").slice(0, 12).toUpperCase();
}
function event(m) {
  const meta = gmail.compactMessage(m);
  const original = gmail.messageBody(m);
  const classified = issue(meta.subject, original);
  const order = orderNumber(meta.subject) || orderNumber(original);
  const customerKey = meta.from;
  // Thread is a stable fallback. Multiple distinct issues for one order remain distinct cases.
  // An order number is unique within the store: verified cross-address replies
  // about the same order and issue family should land in one follow-up case.
  // Without an order number, never infer identity from names alone.
  const caseSeed = order
    ? `order:${order}|${issueFamily(classified.category)}`
    : `thread:${meta.threadId}|${customerKey}|${issueFamily(classified.category)}`;
  const caseId = "CASE-" + crypto.createHash("sha256").update(caseSeed).digest("hex").slice(0, 12).toUpperCase();
  return {
    eventId: "gmail:" + meta.id, caseId, gmailId: meta.id, threadId: meta.threadId,
    source: "Gmail", customerEmail: customerKey, subject: meta.subject,
    orderNumber: order, receivedAt: meta.date,
    originalExcerpt: original.slice(0, 1800), // Gmail owns the complete original.
    originalUrl: `https://mail.google.com/mail/u/0/#all/${meta.threadId}`,
    ...classified, status: "待核实", replyVerified: false, crmGrade: "待核验",
    nextAction: classified.summary, assessedAt: new Date().toISOString(),
  };
}
async function allEvents(max = 250) {
  const rows = [];
  let cursor;
  do {
    const page = await list({ prefix: PREFIX, limit: Math.min(1000, max), cursor, access: "private" });
    const items = (page.blobs || []).slice(0, Math.max(0, max - rows.length));
    for (let start = 0; start < items.length; start += 10) {
      const batch = await Promise.all(items.slice(start, start + 10).map(blob => read(blob.pathname).catch(() => null)));
      for (const record of batch) if (record) rows.push(record);
    }
    if (rows.length >= max) return rows;
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return rows;
}
function groupCases(events) {
  const map = new Map();
  for (const e of events) {
    const key = canonicalCaseId(e);
    const old = map.get(key);
    if (!old) map.set(key, { ...e, caseId:key, messageCount: 1, eventIds: [e.eventId], emails: [e.customerEmail] });
    else {
      old.messageCount++;
      old.eventIds.push(e.eventId);
      if (!old.emails.includes(e.customerEmail)) old.emails.push(e.customerEmail);
      if (({ P0: 0, P1: 1, P2: 2 })[e.priority] < ({ P0: 0, P1: 1, P2: 2 })[old.priority]) {
        old.priority = e.priority;
        old.category = e.category;
        old.nextAction = e.nextAction;
        old.summary = e.summary;
      }
      if (e.receivedAt > old.receivedAt) Object.assign(old, { subject: e.subject, receivedAt: e.receivedAt, originalExcerpt: e.originalExcerpt, originalUrl: e.originalUrl });
      if (e.crmVerified && !old.crmVerified) Object.assign(old, {
        crmGrade: e.crmGrade, crmVerified: true, customerName: e.customerName,
        shopifyCustomerId: e.shopifyCustomerId, m180: e.m180, f180: e.f180, rDays: e.rDays,
      });
      if (e.receivedAt >= old.receivedAt) Object.assign(old, {
        replyVerified: e.replyVerified, replyStatus: e.replyStatus,
        latestReplyAt: e.latestReplyAt || null,
      });
    }
  }
  const priorities = { P0: 0, P1: 1, P2: 2 };
  return [...map.values()].sort((a, b) => priorities[a.priority] - priorities[b.priority] || b.receivedAt.localeCompare(a.receivedAt));
}
module.exports = { PREFIX, STATE, DAYS, authorized, read, save, event, allEvents, groupCases, orderNumber, issueFamily };
