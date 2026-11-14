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
    ensureTable:writeback.ensureTable, upsertCase:writeback.upsertCase,
    preflightCaseBatch:writeback.preflightCaseBatch
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
    // Isolate checkpoint/idempotency failure tests from separately tested schema preflight.
    writeback.preflightCaseBatch = batch => batch.length;
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
      else if (key==="ensureTable" || key==="upsertCase" || key==="preflightCaseBatch") writeback[key]=value;
      else cases[key]=value;
    }
  }
});

test("Feishu select conversion failure halts batch, preserves cursor, and replays without lost Cases", async () => {
  const originals = {
    authorized: cases.authorized, allEvents: cases.allEvents, groupCases: cases.groupCases,
    read: cases.read, save: cases.save, tenantToken: feishu.tenantToken,
    ensureTable: writeback.ensureTable, upsertCase: writeback.upsertCase,
    preflightCaseBatch: writeback.preflightCaseBatch,
  };
  const rows = ["CASE-111111111111","CASE-222222222222","CASE-333333333333"]
    .map(caseId => ({ caseId }));
  let checkpoint = { offset: 0 };
  let saved = 0, attempted = [];
  let failSchema = true;
  const stored = new Set();
  const invoke = async () => {
    const res = { code: 200, body: null, setHeader() {},
      status(code) { this.code = code; return this; },
      json(body) { this.body = body; return this; } };
    await handler({ method: "GET" }, res);
    return res;
  };
  const oldError = console.error;
  try {
    cases.authorized = () => true;
    cases.allEvents = async () => rows;
    cases.groupCases = () => rows;
    cases.read = async () => checkpoint;
    cases.save = async (_path, data) => { saved++; checkpoint = data; };
    feishu.tenantToken = async () => "fake-token";
    writeback.ensureTable = async () => ({ tableId: writeback.TABLE, schema: [] });
    writeback.preflightCaseBatch = batch => batch.length;
    writeback.upsertCase = async (_token, tableId, item) => {
      assert.equal(tableId, writeback.TABLE);
      attempted.push(item.caseId);
      if (failSchema && item.caseId === rows[1].caseId) {
        throw Error("Feishu Bitable 200 / MultiSelectFieldConvFail");
      }
      const result = stored.has(item.caseId) ? "updated" : "created";
      stored.add(item.caseId);
      return result;
    };
    const logged = [];
    console.error = (...args) => logged.push(args.map(String).join(" "));
    const first = await invoke();
    assert.equal(first.code, 502);
    assert.equal(first.body.blockedReason, "case_schema_conversion");
    assert.equal(first.body.processed, 2);
    assert.equal(first.body.batchSize, 3);
    assert.equal(first.body.failed, 1);
    assert.deepEqual(attempted, [rows[0].caseId, rows[1].caseId]);
    assert.equal(saved, 0);
    assert.equal(checkpoint.offset, 0);
    assert.equal(stored.size, 1);
    assert.equal(logged.some(line => line.includes("schema_conversion_blocked")), true);

    failSchema = false;
    const second = await invoke();
    assert.equal(second.code, 200);
    assert.equal(second.body.blockedReason, null);
    assert.equal(second.body.created, 2);
    assert.equal(second.body.updated, 1);
    assert.equal(stored.size, 3);
    assert.equal(saved, 1);
    assert.equal(checkpoint.offset, 0);
  } finally {
    console.error = oldError;
    for (const [key, value] of Object.entries(originals)) {
      if (key === "tenantToken") feishu.tenantToken = value;
      else if (key === "ensureTable" || key === "upsertCase" || key === "preflightCaseBatch") writeback[key] = value;
      else cases[key] = value;
    }
  }
});
