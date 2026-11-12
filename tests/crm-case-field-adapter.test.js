"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { adaptFields } = require("../lib/crm-case-field-adapter");

// Live table schema: 问题类别/任务优先级/沟通渠道/沟通方向 are single-select;
// CRM等级（Case核验） is the only multi-select field.
const schema = [
  {field_name:"问题类别",type:3},
  {field_name:"任务优先级",type:3},
  {field_name:"沟通渠道",type:3},
  {field_name:"沟通方向",type:3},
  {field_name:"CRM等级（Case核验）",type:4},
  {field_name:"邮件数量",type:2},
  {field_name:"客户邮箱",type:1}
];

test("four live single-select fields remain strings and CRM grade multi-select becomes array",()=> {
  assert.deepEqual(adaptFields({
    "问题类别":"物流查询",
    "任务优先级":"高",
    "沟通渠道":"Gmail",
    "沟通方向":"客户发起",
    "CRM等级（Case核验）":["S+","待核验"],
    "邮件数量":2,
    "客户邮箱":"test@example.invalid"
  },schema),{
    "问题类别":"物流查询",
    "任务优先级":"高",
    "沟通渠道":"Gmail",
    "沟通方向":"客户发起",
    "CRM等级（Case核验）":["S+","待核验"],
    "邮件数量":2,
    "客户邮箱":"test@example.invalid"
  });
});
test("CRM grade multi-select deduplicates and trims",()=>assert.deepEqual(
  adaptFields({"CRM等级（Case核验）":[" S+ ","S+","待核验"]},schema),
  {"CRM等级（Case核验）":["S+","待核验"]}
));
test("empty multi-select is omitted while single-select remains scalar",()=>assert.deepEqual(
  adaptFields({"CRM等级（Case核验）":"","问题类别":"其他"},schema),
  {"问题类别":"其他"}
));
test("unknown field and unavailable schema fail closed",()=> {
  assert.throws(()=>adaptFields({missing:"x"},schema),/schema missing/);
  assert.throws(()=>adaptFields({"问题类别":"x"},[]),/unavailable/);
});
test("invalid select shapes fail closed",()=> {
  assert.throws(()=>adaptFields({"问题类别":["高","普通"]},schema),/single-select/);
  assert.throws(()=>adaptFields({"CRM等级（Case核验）":[42]},schema),/multi-select/);
});
