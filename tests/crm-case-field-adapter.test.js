"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { adaptFields } = require("../lib/crm-case-field-adapter");
const schema = [{field_name:"问题类别",type:4,property:{options:[{name:"物流查询"},{name:"其他"},{name:"x"}]}},{field_name:"任务优先级",type:3,property:{options:[{name:"普通"},{name:"高"}]}},{field_name:"邮件数量",type:2},{field_name:"客户邮箱",type:1}];
test("multi select string becomes array; single select remains string",()=> {
  assert.deepEqual(adaptFields({"问题类别":"物流查询","任务优先级":"高","邮件数量":2,"客户邮箱":"test@example.invalid"},schema),
    {"问题类别":["物流查询"],"任务优先级":"高","邮件数量":2,"客户邮箱":"test@example.invalid"});
});
test("multi select deduplicates and trims",()=>assert.deepEqual(adaptFields({"问题类别":[" 物流查询 ","物流查询"]},schema),{"问题类别":["物流查询"]}));
test("empty multi select omitted",()=>assert.deepEqual(adaptFields({"问题类别":"","任务优先级":"普通"},schema),{"任务优先级":"普通"}));
test("unknown field and unavailable schema fail closed",()=> {
  assert.throws(()=>adaptFields({missing:"x"},schema),/schema missing/);
  assert.throws(()=>adaptFields({"问题类别":"x"},[]),/unavailable/);
});
test("invalid select shapes fail closed",()=> {
  assert.throws(()=>adaptFields({"任务优先级":["高","普通"]},schema),/single-select/);
  assert.throws(()=>adaptFields({"问题类别":[42]},schema),/multi-select/);
});

test("configured Feishu select options accept only existing names", () => {
  const configured = [
    {field_name:"问题类别",type:4,property:{options:[{name:"物流查询"},{name:"其他"}]}},
    {field_name:"任务优先级",type:3,property:{options:[{name:"普通"},{name:"高"}]}}
  ];
  assert.deepEqual(adaptFields({"问题类别":"物流查询","任务优先级":"高"},configured),{"问题类别":["物流查询"],"任务优先级":"高"});
  assert.throws(()=>adaptFields({"问题类别":"退款退货"},configured),/option not configured/);
  assert.throws(()=>adaptFields({"任务优先级":"紧急"},configured),/option not configured/);
});

test("select fields without live option schema reject before writes", () => {
  assert.throws(() => adaptFields({"问题类别":"物流查询"}, [{field_name:"问题类别",type:4}]), /options unavailable/);
  assert.throws(() => adaptFields({"任务优先级":"高"}, [{field_name:"任务优先级",type:3}]), /options unavailable/);
});
