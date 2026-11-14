"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const writeback = require("../lib/crm-case-feishu-writeback");
const cases = require("../lib/crm-cases");
const feishu = require("../lib/crm-feishu");
const handler = require("../api/crm-cases-feishu");

const example = {
  caseId: "CASE-123456789ABC", customerEmail: "fake@example.invalid",
  category: "退款申请", priority: "P1", messageCount: 1,
};
function approvedSchema(item = example) {
  const select = {
    "问题类别": [3, ["退款退货", "其他"]],
    "任务优先级": [3, ["高", "普通"]],
    "沟通渠道": [3, ["Gmail"]],
    "沟通方向": [3, ["客户发起"]],
    "CRM等级（Case核验）": [4, ["待核验", "S+", "S", "A", "B", "沉睡", "从未购买"]],
    "任务状态": [3, ["待处理", "处理中", "已完成"]],
  };
  return [...Object.keys(writeback.recordFields(item)), "任务状态"].map(field_name => {
    const options = select[field_name];
    return options ? {
      field_name, type: options[0],
      property: { options: options[1].map(name => ({ name })) }
    } : { field_name, type: field_name === "邮件数量" ? 2 : 1 };
  });
}
function makeRes() {
  return {
    code: null, body: null,
    setHeader() {},
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test("preflight checks every Case, including create-only task status, without Feishu requests", () => {
  const schema = approvedSchema();
  const differentCase = {...example, caseId: "CASE-ABCDEF012345"};
  assert.equal(writeback.preflightCaseBatch([example, differentCase], schema), 2);
  assert.throws(
    () => writeback.preflightCaseBatch([example, example], schema),
    /Duplicate Case ID in batch/,
  );
  assert.throws(
    () => writeback.preflightCaseBatch([example, {...differentCase, crmVerified: true, crmGrade: "legacy"}], schema),
    /option not configured/,
  );
  assert.throws(
    () => writeback.preflightCaseBatch([example], schema.filter(f => f.field_name !== "任务状态")),
    /schema missing: 任务状态/,
  );
  assert.throws(
    () => writeback.preflightCaseBatch([{...example,caseId:"not-a-valid-case"}], schema),
    /Invalid Case ID/,
  );
});

test("authenticated Case dryRun returns only safe counts, no upsert or checkpoint advance", async () => {
  const originals = {
    authorized: cases.authorized, allEvents: cases.allEvents,
    groupCases: cases.groupCases, read: cases.read, save: cases.save,
    tenantToken: feishu.tenantToken, ensureTable: writeback.ensureTable,
    upsertCase: writeback.upsertCase,
  };
  let saves = 0, writes = 0;
  cases.authorized = () => true;
  cases.allEvents = async () => [{fakeEvent: true}];
  cases.groupCases = () => [example];
  cases.read = async () => ({offset:0});
  cases.save = async () => {saves++;};
  feishu.tenantToken = async () => "test-only";
  writeback.ensureTable = async () => ({tableId: writeback.TABLE, schema: approvedSchema()});
  writeback.upsertCase = async () => {writes++; return "created";};
  try {
    const res = makeRes();
    await handler({method:"GET", query:{dryRun:"1"}}, res);
    assert.equal(res.code,200);
    assert.deepEqual(res.body, {
      ok:true, dryRun:true, tableId:writeback.TABLE, checked:1,
      totalCases:1, processed:0, checkpointAdvanced:false,
    });
    assert.equal(writes,0);
    assert.equal(saves,0);

    writeback.ensureTable = async () => ({
      tableId:writeback.TABLE,
      schema:approvedSchema().filter(f => f.field_name !== "任务状态"),
    });
    const blocked = makeRes();
    await handler({method:"GET", query:{dryRun:"1"}}, blocked);
    assert.equal(blocked.code,409);
    assert.equal(blocked.body.blockedReason,"case_schema_preflight");
    assert.deepEqual(blocked.body.diagnostic, {
      code:"field_missing", field:"任务状态"
    });
    assert.equal(JSON.stringify(blocked.body).includes("fake@example.invalid"),false);
    assert.equal(blocked.body.checkpointAdvanced,false);
    assert.equal(blocked.body.processed,0);
    assert.equal(writes,0);
    assert.equal(saves,0);

    // Only known select-field labels can appear. Other schema field names
    // are suppressed even for an authenticated diagnostic request.
    writeback.ensureTable = async () => ({
      tableId:writeback.TABLE,
      schema:approvedSchema().filter(f => f.field_name !== "客户邮箱"),
    });
    const hiddenField = makeRes();
    await handler({method:"GET", query:{dryRun:"1"}}, hiddenField);
    assert.equal(hiddenField.code,409);
    assert.deepEqual(hiddenField.body.diagnostic,{code:"field_missing",field:null});

    // Real option mismatches are distinguishable from field omission without
    // revealing Case values, email, note content or Feishu response bodies.
    writeback.ensureTable = async () => ({
      tableId:writeback.TABLE,
      schema:approvedSchema().map(f => f.field_name === "CRM等级（Case核验）"
        ? {...f, property:{options:[{name:"S+"}]}} : f),
    });
    const badOption = makeRes();
    await handler({method:"GET", query:{dryRun:"1"}}, badOption);
    assert.equal(badOption.code,409);
    assert.deepEqual(badOption.body.diagnostic,{
      code:"option_not_configured",field:"CRM等级（Case核验）"
    });
    assert.equal(writes,0);
    assert.equal(saves,0);

    // The regular cron path must also stop before its first write when any
    // Case schema option is unavailable, and must leave the checkpoint alone.
    const scheduled = makeRes();
    await handler({method:"GET", query:{}}, scheduled);
    assert.equal(scheduled.code,409);
    assert.equal(scheduled.body.dryRun,false);
    assert.equal(scheduled.body.processed,0);
    assert.equal(scheduled.body.checkpointAdvanced,false);
    assert.equal(writes,0);
    assert.equal(saves,0);
  } finally {
    for (const [k,v] of Object.entries(originals)) {
      if (k === "tenantToken") feishu.tenantToken = v;
      else if (k === "ensureTable" || k === "upsertCase") writeback[k] = v;
      else cases[k] = v;
    }
  }
});
