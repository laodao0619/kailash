"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "../api/crm-cases-feishu.js"), "utf8");
function runner({ failOn = 0, failure = new Error("MultiSelectFieldConvFail"), authorized = true, count = 3 } = {}) {
  const saved = [];
  const upserts = [];
  const logs = [];
  const rows = Array.from({ length: count }, (_, i) => ({ caseId: "CASE-" + String(i).padStart(12, "0"), customerEmail: "should-not-leak@private.test" }));
  const cases = {
    authorized: () => authorized,
    allEvents: async () => rows,
    groupCases: x => x,
    read: async () => ({ offset: 0 }),
    save: async (...args) => saved.push(args),
  };
  const writeback = {
    ensureTable: async () => "approved-table",
    upsertCase: async (_token, _table, item) => {
      upserts.push(item.caseId);
      if (upserts.length === failOn) throw failure;
      return "created";
    },
  };
  const module = { exports: {} };
  const fakeConsole = { error: (...args) => logs.push(args.map(String).join(" ")) };
  const requireStub = name => {
    if (name === "../lib/crm-cases") return cases;
    if (name === "../lib/crm-feishu") return { tenantToken: async () => "mock-token" };
    if (name === "../lib/crm-case-feishu-writeback") return writeback;
    throw Error("Unexpected import: " + name);
  };
  vm.runInNewContext("(function(require,module,console){" + source + "\n})", {})(requireStub,module,fakeConsole);
  const result = { statusCode: 200, body: null, headers: {} };
  const res = {
    setHeader: (key,value) => { result.headers[key] = value; },
    status: code => { result.statusCode = code; return res; },
    json: body => { result.body = body; return res; },
  };
  return { run: async () => { await module.exports({ method: "GET" }, res); return result; }, saved, upserts, logs };
}

test("deterministic select-conversion error halts batch, retains checkpoint, hides upstream text", async () => {
  const state = runner({ failOn: 1, failure: new Error("MultiSelectFieldConvFail secret-token should-not-leak@private.test") });
  const result = await state.run();
  assert.equal(result.statusCode, 502);
  assert.equal(result.body.processed, 1);
  assert.equal(result.body.unattempted, 2);
  assert.equal(result.body.failed, 1);
  assert.equal(state.upserts.length, 1);
  assert.equal(state.saved.length, 0);
  assert.match(state.logs.join(" "), /feishu_field_conversion/);
  assert.doesNotMatch(state.logs.join(" "), /secret-token|should-not-leak|CASE-/);
});

test("successful batch preserves existing checkpoint behavior", async () => {
  const state = runner({ failOn: 0 });
  const result = await state.run();
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.processed, 3);
  assert.equal(result.body.unattempted, 0);
  assert.equal(result.body.created, 3);
  assert.equal(state.saved.length, 1);
  assert.equal(state.saved[0][1].lastBatchProcessed, 3);
});

test("failure after successful upsert stops and retains prior checkpoint", async () => {
  const state = runner({ failOn: 2, failure: new Error("429 RateLimit") });
  const result = await state.run();
  assert.equal(result.statusCode, 502);
  assert.equal(result.body.created, 1);
  assert.equal(result.body.processed, 2);
  assert.equal(result.body.unattempted, 1);
  assert.equal(state.saved.length, 0);
  assert.match(state.logs.join(" "), /feishu_rate_limited/);
});

test("unauthorized request never fetches or writes data", async () => {
  const state = runner({ authorized: false });
  const result = await state.run();
  assert.equal(result.statusCode, 401);
  assert.equal(state.upserts.length, 0);
  assert.equal(state.saved.length, 0);
});
