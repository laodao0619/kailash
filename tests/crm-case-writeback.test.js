"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { recordFields, HUMAN } = require("../lib/crm-case-feishu-writeback");
const gmail = require("../lib/crm-gmail");
const cases = require("../lib/crm-cases");

test("Case writeback leaves human fields untouched during later syncs", () => {
  const fields = recordFields({
    caseId:"CASE-123456789ABC", customerEmail:"customer@example.com",
    category:"尺寸售后", messageCount:2, receivedAt:"2026-11-07T04:23:00.000Z",
    originalExcerpt:"Bracelet too loose",
  }, 1000);
  for (const name of HUMAN) assert.equal(Object.hasOwn(fields,name),false);
  assert.equal(fields["邮件数量"],2);
  assert.equal(fields["最后来信时间"],Date.parse("2026-11-07T04:23:00.000Z"));
});

test("review notification is filtered, including already archived Case", () => {
  const m = {threadId:"t",labelIds:["INBOX"],payload:{headers:[
    {name:"From",value:"noreply.notifications@trustpilot.com"},
    {name:"Subject",value:"You've got a new 5-star review"},
    {name:"Date",value:"Sat, 07 Nov 2026 14:40:00 GMT"},
  ]}};
  assert.equal(gmail.classifyMessage(m),"review_notification");
  assert.deepEqual(cases.groupCases([{
    caseId:"CASE-123456789ABC", eventId:"gmail:1",
    customerEmail:"noreply.notifications@trustpilot.com",
    receivedAt:"2026-11-07T14:40:00Z",
  }]),[]);
});

test("quoted order can provide case key without polluting client excerpt", () => {
  const full = "See emails below\nFrom: Corinne\nA shipment from order 7159 is on the way";
  const m={id:"g1",threadId:"t1",internalDate:String(Date.parse("2026-11-07T08:08:00Z")),
    snippet:full,payload:{mimeType:"text/plain",body:{data:Buffer.from(full).toString("base64url")},headers:[
    {name:"From",value:"Corinne <arcopat@orange.fr>"},
    {name:"Subject",value:"URGENT ORDER NOT RECEIVED"},
    {name:"Date",value:"Sat, 07 Nov 2026 08:08:00 GMT"},
  ]}};
  const e=cases.event(m);
  assert.equal(e.orderNumber,"7159");
  assert.equal(e.originalExcerpt,"See emails below");
});
