"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const cases = require("../lib/crm-cases");
const feishu = require("../lib/crm-feishu");
const writeback = require("../lib/crm-case-feishu-writeback");
const handler = require("../api/crm-cases-feishu");

// Pure mocked cron regression. Does NOT perform a live Feishu write or
// establish production checkpoint acceptance.
test("partial batch failure retains checkpoint; replay is idempotent and then advances", async () => {
  const originals = {
    authorized:cases.authorized, allEvents:cases.allEvents,
    groupCases:cases.groupCases, read:cases.read, save:cases.save,
    tenantToken:feishu.tenantToken,
    ensureTable:writeback.ensureTable, upsertCase:writeback.upsertCase
  };
  const ids = ["CASE-123456789ABC","CASE-ABCDEF123456"];
  const rows = ids.map(caseId=>({caseId}));
  let checkpoint = {offset:0};
  let saveCount = 0;
  let attempts = 0;
  let failSecond = true;
  const stored = new Set();
  const invoke = async () => {
    const res = {
      statusCode:200, body:null,
      setHeader(){},
      status(code){this.statusCode=code;return this;},
      json(data){this.body=data;return this;}
    };
    await handler({method:"GET"},res);
    return res;
  };
  try {
    cases.authorized = () => true;
    cases.allEvents = async () => rows;
    cases.groupCases = () => rows;
    cases.read = async () => checkpoint;
    cases.save = async (_path, next) => {saveCount++;checkpoint=next;};
    feishu.tenantToken = async () => "fake-token";
    writeback.ensureTable = async () => ({tableId:writeback.TABLE,schema:[]});
    writeback.upsertCase = async (_token,tableId,row) => {
      assert.equal(tableId,writeback.TABLE);
      attempts++;
      if (failSecond && row.caseId===ids[1]) throw Error("synthetic_failure");
      const result=stored.has(row.caseId)?"updated":"created";
      stored.add(row.caseId);
      return result;
    };
    const failed = await invoke();
    assert.equal(failed.statusCode,502);
    assert.equal(failed.body.failed,1);
    assert.equal(saveCount,0);
    assert.equal(checkpoint.offset,0);
    assert.equal(stored.size,1);
    failSecond=false;
    const recovered=await invoke();
    assert.equal(recovered.statusCode,200);
    assert.equal(recovered.body.ok,true);
    assert.equal(recovered.body.failed,0);
    assert.equal(recovered.body.updated,1);
    assert.equal(recovered.body.created,1);
    assert.equal(attempts,4);
    assert.equal(stored.size,2);
    assert.equal(saveCount,1);
    // After completing all grouped cases, the existing cron uses offset=0 to
    // start its next recurring sweep. This is not a skipped/advanced cursor.
    assert.equal(checkpoint.offset,0);
    assert.equal(checkpoint.lastBatchProcessed,2);
    assert.equal(checkpoint.lastBatchFailed,0);
  } finally {
    for (const [key,value] of Object.entries(originals)) {
      if (key==="tenantToken") feishu.tenantToken=value;
      else if (key==="ensureTable" || key==="upsertCase") writeback[key]=value;
      else cases[key]=value;
    }
  }
});
