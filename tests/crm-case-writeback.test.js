"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { recordFields, HUMAN, TABLE, ensureTable, upsertCase } = require("../lib/crm-case-feishu-writeback");
const feishu = require("../lib/crm-feishu");
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
  assert.equal(fields["记录时间"],Date.parse("2026-11-07T04:23:00.000Z"));
  assert.equal(fields["数据来源ID"],"case:CASE-123456789ABC");
  assert.equal(fields["问题类别"],"产品问题");
  assert.equal(TABLE,"tblNi7C5q5FYlG06");
});

test("Case updates an existing communication table record without touching task state", async () => {
  const originalFind = feishu.findBy, originalRequest = feishu.request;
  const calls = [];
  feishu.findBy = async (_token, table, field, value) => {
    assert.equal(table,TABLE);
    assert.equal(field,"数据来源ID");
    assert.equal(value,"case:CASE-123456789ABC");
    return [{record_id:"rec-existing"}];
  };
  feishu.request = async (...args) => {calls.push(args);return {};};
  try {
    const result=await upsertCase("test",TABLE,{caseId:"CASE-123456789ABC",category:"未收到货",priority:"紧急"});
    assert.equal(result,"updated");
    assert.match(calls[0][1],/tblNi7C5q5FYlG06\/records\/rec-existing$/);
    assert.equal(calls[0][2],"PUT");
    for (const key of HUMAN) assert.equal(Object.hasOwn(calls[0][3].fields,key),false);
  } finally { feishu.findBy=originalFind;feishu.request=originalRequest; }
});

test("Case sync refuses to create another CRM table", async () => {
  const original = feishu.request, calls=[];
  feishu.request=async (_t,path,method="GET",body) => {
    calls.push({path,method,body});
    if(path.endsWith("/tables?page_size=100"))return {items:[{table_id:TABLE,name:"客户沟通与跟进"}]};
    return {items:[{field_name:"Case ID"},{field_name:"关联邮箱"},{field_name:"客户原文摘录"},{field_name:"客服回复状态"},{field_name:"邮件数量"},{field_name:"CRM等级（Case核验）"}]};
  };
  try{
    assert.equal(await ensureTable("test"),TABLE);
    assert.equal(calls.filter(c=>c.method!=="GET").length,0);
  }finally{feishu.request=original;}
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
