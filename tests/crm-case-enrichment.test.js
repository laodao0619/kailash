"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { verifiedCustomer, replyEvidence } = require("../lib/crm-case-enrichment");

test("CRM grade requires exactly one valid customer and a verified grade", () => {
  const valid = { fields: { "客户数据状态": "有效", "CRM等级": "A", "Shopify客户ID": "gid://shopify/Customer/12", "客户姓名": "Peke Lai", "近180天净消费": 950, "近180天有效订单数": 2, "最近购买距今天数R": 7 } };
  assert.equal(verifiedCustomer([valid]).crmGrade, "A");
  assert.equal(verifiedCustomer([valid]).m180, 950);
  assert.equal(verifiedCustomer([valid, valid]), null);
  assert.equal(verifiedCustomer([{ fields: { ...valid.fields, "客户数据状态": "待人工复核" } }]), null);
  assert.equal(verifiedCustomer([{ fields: { ...valid.fields, "CRM等级": "???" } }]), null);
});

test("later service reply is evidence of response, not resolved status", () => {
  const msg = (from, timestamp) => ({ internalDate: String(timestamp), payload: { headers: [{ name: "From", value: from }] } });
  const incoming = msg("customer@example.com", 2000);
  const thread = { messages: [msg("service@kailashenergy.com", 1000), incoming, msg("service@kailashenergy.com", 3000)] };
  const result = replyEvidence(thread, incoming);
  assert.equal(result.replyVerified, true);
  assert.match(result.replyStatus, /未确认解决/);
  const waiting = replyEvidence({ messages: thread.messages.slice(0, 2) }, incoming);
  assert.equal(waiting.replyVerified, false);
});
