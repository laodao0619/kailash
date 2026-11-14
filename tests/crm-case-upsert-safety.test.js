"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const feishu = require("../lib/crm-feishu");
const { upsertCase, TABLE, HUMAN, recordFields, assertNoHumanFields } = require("../lib/crm-case-feishu-writeback");

// Match the actual approved table: four single-select fields and exactly one
// multi-select, CRM等级（Case核验）. Never treat 问题类别 as a multi-select.
function liveShapeFixture(c) {
  const options = {
    "问题类别": ["物流查询","其他"],
    "任务优先级": ["高","普通","紧急"],
    "沟通渠道": ["Gmail"],
    "沟通方向": ["客户发起"],
    "CRM等级（Case核验）": ["A","B","待核验","从未购买","S+","S","沉睡"],
    "任务状态": ["待处理","处理中"]
  };
  const names = new Set([...Object.keys(recordFields(c,1)), "任务状态"]);
  return [...names].map(field_name => ({
    field_name,
    type: field_name === "CRM等级（Case核验）" ? 4
      : ["问题类别","任务优先级","沟通渠道","沟通方向","任务状态"].includes(field_name) ? 3
      : field_name === "邮件数量" ? 2 : 1,
    ...(options[field_name] ? {property:{options:options[field_name].map(name=>({name}))}} : {})
  }));
}

test("existing Case uses documented PUT, writes CRM grade array, preserves human-owned fields", async () => {
  const originalRequest = feishu.request, originalFind = feishu.findBy;
  const calls = [];
  const c = {
    caseId: "CASE-ABCDEF123456", category: "物流", priority: "P1",
    customerEmail: "case@example.invalid", crmVerified: true, crmGrade: "S+"
  };
  const schema = liveShapeFixture(c);
  const record = { "负责人":"人工负责人", "任务状态":"处理中", "处理结果":"保留人工结果" };
  feishu.findBy = async () => [{record_id:"rec_existing",fields:{...record}}];
  feishu.request = async (_token, path, method = "GET", body) => {
    calls.push({path,method,body});
    if (path.endsWith("/fields?page_size=100")) return {items:schema,has_more:false};
    if (method === "PUT") Object.assign(record,body.fields);
    return {};
  };
  try {
    assert.equal(await upsertCase("fake-token", TABLE, c), "updated");
    const writes = calls.filter(x=>x.method!=="GET");
    assert.equal(writes.length,1);
    assert.equal(writes[0].method,"PUT");
    assert.ok(writes[0].path.endsWith("/rec_existing"));
    assert.equal(writes[0].body.fields["问题类别"],"物流查询");
    assert.equal(writes[0].body.fields["任务优先级"],"高");
    assert.equal(writes[0].body.fields["沟通渠道"],"Gmail");
    assert.equal(writes[0].body.fields["沟通方向"],"客户发起");
    assert.deepEqual(writes[0].body.fields["CRM等级（Case核验）"],["S+"]);
    for (const name of HUMAN) {
      assert.equal(Object.hasOwn(writes[0].body.fields,name),false);
    }
    assert.equal(record["负责人"],"人工负责人");
    assert.equal(record["任务状态"],"处理中");
    assert.equal(record["处理结果"],"保留人工结果");
  } finally {
    feishu.request=originalRequest;feishu.findBy=originalFind;
  }
});

test("duplicate Case source IDs reject without any Feishu write", async () => {
  const originalFind=feishu.findBy, originalRequest=feishu.request;
  let writes=0;
  feishu.findBy=async()=>[{record_id:"rec_one"},{record_id:"rec_two"}];
  feishu.request=async()=>{writes++;return{};};
  try {
    await assert.rejects(upsertCase("fake-token",TABLE,{caseId:"CASE-ABCDEF123456"}),/Duplicate Case ID/);
    assert.equal(writes,0);
  } finally {feishu.findBy=originalFind;feishu.request=originalRequest;}
});

test("unknown CRM grade option fails closed before POST or PUT", async () => {
  const originalRequest=feishu.request, originalFind=feishu.findBy;
  const c={caseId:"CASE-ABCDEF123456",category:"物流",priority:"P1",crmVerified:true,crmGrade:"旧等级"};
  const schema=liveShapeFixture(c);
  let writes=0;
  feishu.findBy=async()=>[];
  feishu.request=async (_token,path,method="GET")=>{
    if (method!=="GET") writes++;
    if (path.endsWith("/fields?page_size=100")) return {items:schema,has_more:false};
    return {};
  };
  try {
    await assert.rejects(upsertCase("fake-token",TABLE,c),/option not configured/);
    assert.equal(writes,0);
  } finally {feishu.request=originalRequest;feishu.findBy=originalFind;}
});

test("Case writer guards every human-owned field, permitting only the create-time pending state", () => {
  for (const field of HUMAN) {
    assert.throws(
      () => assertNoHumanFields({ [field]: "synthetic human value" }),
      /Refusing Case write to human-owned field/
    );
  }
  assert.deepEqual(
    assertNoHumanFields({ "任务状态": "待处理", "数据来源ID": "case:CASE-ABCDEF123456" }, { initialCreate: true }),
    { "任务状态": "待处理", "数据来源ID": "case:CASE-ABCDEF123456" }
  );
  for (const forbidden of ["处理中", "已完成", "", null]) {
    assert.throws(
      () => assertNoHumanFields({ "任务状态": forbidden }, { initialCreate: true }),
      /Refusing Case write to human-owned field/
    );
  }
  assert.throws(
    () => assertNoHumanFields({ "负责人": "synthetic owner", "任务状态": "待处理" }, { initialCreate: true }),
    /human-owned field/
  );
  assert.throws(() => assertNoHumanFields(null), /Invalid Case write fields/);
  assert.throws(() => assertNoHumanFields([]), /Invalid Case write fields/);
});
