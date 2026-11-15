"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { mock } = require("node:test");
const feishu = require("../lib/crm-feishu");
const cases = require("../lib/crm-cases");
const writeback = require("../lib/crm-case-feishu-writeback");
const handler = require("../api/crm-cases-feishu");

const CASE_ID = "CASE-ABCD12345678";

// Mock-only safety regressions; no real Feishu customer data or credentials.
test("Case identity search rejects missing, truncated, duplicated, and malformed results before any write", async () => {
  const invalid = [
    {},
    { items: [] },
    { has_more: true, items: [] },
    { has_more: false, items: null },
    { has_more: false, items: [{ record_id: "" }] },
    { has_more: false, items: [{ record_id: "one" }, { record_id: "two" }] },
  ];
  for (const data of invalid) {
    let reads = 0;
    const stub = mock.method(globalThis, "fetch", async (url, opts) => {
      assert.match(url, /\/records\/search\?page_size=5$/);
      assert.equal(opts.method, "POST");
      const payload = JSON.parse(opts.body);
      assert.equal(payload.filter.conditions[0].field_name, "数据来源ID");
      assert.deepEqual(payload.filter.conditions[0].value, ["case:" + CASE_ID]);
      reads++;
      return { ok: true, status: 200, json: async () => ({ code: 0, data }) };
    });
    try {
      await assert.rejects(
        writeback.upsertCase("synthetic-tenant", writeback.TABLE, { caseId: CASE_ID }, []),
        /Feishu Case identity|Duplicate Case ID/
      );
      assert.equal(reads, 1);
    } finally {
      stub.mock.restore();
    }
  }
});

test("Case identity search permits an explicitly complete empty result", async () => {
  const stub = mock.method(globalThis, "fetch", async () => ({
    ok: true, status: 200,
    json: async () => ({ code: 0, data: { has_more: false, items: [] } }),
  }));
  try {
    const rows = await writeback.findCaseRecords("synthetic-tenant", CASE_ID);
    assert.deepEqual(rows, []);
    assert.equal(stub.mock.callCount(), 1);
  } finally {
    stub.mock.restore();
  }
});

test("outer Case handler redacts any secret or customer information in upstream errors", async () => {
  const authorized = mock.method(cases, "authorized", () => true);
  const token = mock.method(feishu, "tenantToken", async () => {
    throw Error("upstream private-person@example.invalid bearer-leak-example");
  });
  const errors = [];
  const logger = mock.method(console, "error", (...args) => errors.push(args.join(" ")));
  const res = {
    statusCode: 200, body: null,
    setHeader() {},
    status(n) { this.statusCode = n; return this; },
    json(body) { this.body = body; return this; },
  };
  try {
    await handler({ method: "GET" }, res);
    assert.equal(res.statusCode, 502);
    assert.equal(res.body.error, "feishu_writeback_unavailable");
    assert.equal(res.body.retryable, true);
    const visible = JSON.stringify(res.body) + errors.join("\n");
    assert.equal(visible.includes("private-person@"), false);
    assert.equal(visible.includes("bearer-leak-example"), false);
    assert.ok(errors.some(line => line.includes("case_upsert_failed")));
  } finally {
    for (const x of [authorized, token, logger]) x.mock.restore();
  }
});


test("incomplete Case identity halts the cron batch without advancing a checkpoint", async () => {
  const rows = [
    { caseId: "CASE-111111111111" },
    { caseId: "CASE-222222222222" },
  ];
  let attempted = 0, saved = 0;
  const stubs = [
    mock.method(cases, "authorized", () => true),
    mock.method(feishu, "tenantToken", async () => "synthetic-tenant"),
    mock.method(cases, "allEvents", async () => rows),
    mock.method(cases, "groupCases", () => rows),
    mock.method(cases, "read", async () => ({ offset: 0 })),
    mock.method(cases, "save", async () => { saved++; }),
    mock.method(writeback, "ensureTable", async () => ({ tableId: writeback.TABLE, schema: [] })),
    mock.method(writeback, "preflightCaseBatch", batch => batch.length),
    mock.method(writeback, "upsertCase", async () => {
      attempted++;
      throw Error("Feishu Case identity lookup incomplete");
    }),
  ];
  const res = {
    statusCode: 200, body: null, setHeader() {},
    status(n) { this.statusCode = n; return this; },
    json(body) { this.body = body; return this; },
  };
  const logged = [];
  const logger = mock.method(console, "error", (...args) => logged.push(args.join(" ")));
  try {
    await handler({ method: "GET" }, res);
    assert.equal(res.statusCode, 502);
    assert.equal(res.body.blockedReason, "case_identity_lookup");
    assert.equal(res.body.processed, 1);
    assert.equal(res.body.failed, 1);
    assert.equal(attempted, 1, "never fan out an incomplete lookup across the batch");
    assert.equal(saved, 0, "checkpoint must not move on identity ambiguity");
    assert.ok(logged.some(line => line.includes("case_identity_blocked")));
    assert.equal(JSON.stringify(res.body).includes("CASE-"), false);
  } finally {
    logger.mock.restore();
    for (const stub of stubs) stub.mock.restore();
  }
});
