"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { adaptFields } = require("../lib/crm-case-field-adapter");

// Verified 2026-11-12: four select fields are single-select. The only multi-select
// in the approved communication table is CRM等级（Case核验）.
const allowedGrades = ["A", "B", "待核验", "从未购买", "S+", "S", "沉睡"];
const schema = [
  {field_name:"问题类别",type:3,property:{options:["物流查询","其他","退款退货"].map(name=>({name}))}},
  {field_name:"任务优先级",type:3,property:{options:["普通","高","紧急"].map(name=>({name}))}},
  {field_name:"沟通渠道",type:3,property:{options:[{name:"Gmail"}]}},
  {field_name:"沟通方向",type:3,property:{options:[{name:"客户发起"}]}},
  {field_name:"CRM等级（Case核验）",type:4,property:{options:allowedGrades.map(name=>({name}))}},
  {field_name:"邮件数量",type:2},
  {field_name:"客户邮箱",type:1},
];

test("actual four single-select fields remain strings; CRM grade is a string array", () => {
  const fields = {
    "问题类别":"物流查询", "任务优先级":"高",
    "沟通渠道":"Gmail", "沟通方向":"客户发起",
    "CRM等级（Case核验）":"S+", "邮件数量":2,
    "客户邮箱":"test@example.invalid"
  };
  assert.deepEqual(adaptFields(fields,schema), {
    ...fields, "CRM等级（Case核验）":["S+"]
  });
});
test("CRM grade multi-select deduplicates and trims", () => {
  assert.deepEqual(adaptFields({"CRM等级（Case核验）":[" S+ ","S+","待核验"]},schema),
    {"CRM等级（Case核验）":["S+","待核验"]});
});
test("empty multi-select is omitted while single-select remains scalar", () => {
  assert.deepEqual(adaptFields({"CRM等级（Case核验）":"","问题类别":"其他"},schema),
    {"问题类别":"其他"});
});
test("all seven approved CRM grade options are accepted", () => {
  for (const grade of allowedGrades) {
    assert.deepEqual(adaptFields({"CRM等级（Case核验）":grade},schema),
      {"CRM等级（Case核验）":[grade]});
  }
});
test("unknown fields and unavailable schema fail closed", () => {
  assert.throws(()=>adaptFields({missing:"x"},schema),/schema missing/);
  assert.throws(()=>adaptFields({"问题类别":"物流查询"},[]),/unavailable/);
});
test("invalid single-select and multi-select shapes fail closed", () => {
  assert.throws(()=>adaptFields({"问题类别":["物流查询","其他"]},schema),/single-select/);
  assert.throws(()=>adaptFields({"CRM等级（Case核验）":[42]},schema),/multi-select/);
});
test("configured options reject unknown select values before any write", () => {
  assert.throws(()=>adaptFields({"CRM等级（Case核验）":"旧版等级"},schema),/option not configured/);
  assert.throws(()=>adaptFields({"问题类别":"未知选项"},schema),/option not configured/);
  assert.throws(()=>adaptFields({"任务优先级":"不存在"},schema),/option not configured/);
});
test("missing live option schema rejects both single and multi selects", () => {
  assert.throws(()=>adaptFields({"问题类别":"物流查询"},[{field_name:"问题类别",type:3}]),/options unavailable/);
  assert.throws(()=>adaptFields({"CRM等级（Case核验）":"S+"},[{field_name:"CRM等级（Case核验）",type:4}]),/options unavailable/);
});
