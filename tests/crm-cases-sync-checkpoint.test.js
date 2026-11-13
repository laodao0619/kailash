"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { mock } = require("node:test");
const handler = require("../api/crm-cases-sync");
const cases = require("../lib/crm-cases");
const gmail = require("../lib/crm-gmail");
const feishu = require("../lib/crm-feishu");
const enrichment = require("../lib/crm-case-enrichment");

const previousBlob = process.env.BLOB_READ_WRITE_TOKEN;
process.env.BLOB_READ_WRITE_TOKEN = "synthetic-private-test";
test.after(() => {
  if (previousBlob === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
  else process.env.BLOB_READ_WRITE_TOKEN = previousBlob;
});
function response() {
  return { code: 200, body: null, setHeader() {}, status(x) { this.code = x; return this; }, json(x) { this.body = x; return this; } };
}
function fixtures({ failed = false, dryRun = false, gmailReason = null, messageIds = ["ok-1", "bad-2"] } = {}) {
  const restores = [];
  const stub = (obj, key, fn) => restores.push(mock.method(obj, key, fn));
  const checkpoint = { pageToken: "existing-cursor", scanned: 10, accepted: 4, excluded: 6, lastRunAt: "2026-11-13T00:00:00Z" };
  const writes = [];
  const messageReads = [];
  stub(cases, "authorized", () => true);
  stub(cases, "read", async () => checkpoint);
  stub(cases, "save", async (path, value) => writes.push({ path, value: structuredClone(value) }));
  stub(gmail, "token", async () => "fake-oauth");
  stub(feishu, "tenantToken", async () => "fake-feishu");
  stub(gmail, "listMessages", async (_token, args) => {
    assert.equal(args.pageToken, "existing-cursor");
    return { messages: messageIds.map(id => ({ id })), nextPageToken: "new-cursor" };
  });
  stub(gmail, "message", async (_token, id) => {
    messageReads.push(id);
    if (failed && id === "bad-2") {
      const err = Error("Gmail request failed: 403");
      if (gmailReason) err.gmailReason = gmailReason;
      throw err;
    }
    return { id };
  });
  stub(gmail, "classifyMessage", () => "candidate");
  stub(cases, "event", m => ({ eventId: "gmail:" + m.id }));
  stub(enrichment, "enrich", async event => event);
  return {
    writes, messageReads, checkpoint,
    req: { method: "GET", query: dryRun ? { dry_run: "1" } : {}, headers: {} },
    restore() { for (const item of restores) item.mock.restore(); },
  };
}

test("Gmail 403 is HTTP 502 and leaves cursor and counters unchanged", async () => {
  const sample = fixtures({ failed: true });
  const originalError = console.error;
  console.error = () => {};
  try {
    const out = response();
    await handler(sample.req, out);
    assert.equal(out.code, 502);
    assert.equal(out.body.ok, false);
    assert.equal(out.body.retryable, true);
    assert.equal(out.body.cursorAdvanced, false);
    assert.equal(out.body.failureTypes.gmail_403, 1);
    assert.equal(sample.writes.length, 2);
    assert.equal(sample.writes[0].path, cases.PREFIX + "ok-1.json");
    const stateWrite = sample.writes.at(-1);
    assert.equal(stateWrite.path, cases.STATE);
    assert.equal(stateWrite.value.pageToken, "existing-cursor");
    assert.equal(stateWrite.value.scanned, 10);
    assert.equal(stateWrite.value.accepted, 4);
    assert.equal(stateWrite.value.lastRunAt, "2026-11-13T00:00:00Z");
    assert.equal(stateWrite.value.blocked, true);
    assert.equal(stateWrite.value.lastErrorCount, 1);
    assert.equal("gmailId" in stateWrite.value, false);
  } finally {
    console.error = originalError;
    sample.restore();
  }
});

test("successful retry advances cursor only after all message saves", async () => {
  const sample = fixtures();
  try {
    const out = response();
    await handler(sample.req, out);
    assert.equal(out.code, 200);
    assert.equal(out.body.ok, true);
    const stateWrite = sample.writes.at(-1).value;
    assert.equal(stateWrite.pageToken, "new-cursor");
    assert.equal(stateWrite.scanned, 12);
    assert.equal(stateWrite.accepted, 6);
    assert.equal(stateWrite.blocked, false);
    assert.equal(stateWrite.lastErrorCount, 0);
    assert.equal(sample.writes.filter(x => x.path.startsWith(cases.PREFIX)).length, 2);
  } finally { sample.restore(); }
});

test("dry run cannot persist a failed checkpoint or event", async () => {
  const sample = fixtures({ failed: true, dryRun: true });
  const originalError = console.error;
  console.error = () => {};
  try {
    const out = response();
    await handler(sample.req, out);
    assert.equal(out.code, 502);
    assert.equal(sample.writes.length, 0);
  } finally {
    console.error = originalError;
    sample.restore();
  }
});

test("missing private Blob credential fails before reading Gmail", async () => {
  const prev = process.env.BLOB_READ_WRITE_TOKEN;
  const prevStore = process.env.BLOB_STORE_ID;
  delete process.env.BLOB_READ_WRITE_TOKEN;
  delete process.env.BLOB_STORE_ID;
  const auth = mock.method(cases, "authorized", () => true);
  try {
    const out = response();
    await handler({ method: "GET", headers: {} }, out);
    assert.equal(out.code, 503);
  } finally {
    auth.mock.restore();
    if (prev !== undefined) process.env.BLOB_READ_WRITE_TOKEN = prev;
    if (prevStore !== undefined) process.env.BLOB_STORE_ID = prevStore;
  }
});


test("403 insufficientPermissions is isolated as OAuth scope blocker without moving Case cursor", async () => {
  const sample = fixtures({ failed: true, gmailReason: "insufficientPermissions" });
  const old = console.error;
  console.error = () => {};
  try {
    const out = response();
    await handler(sample.req, out);
    assert.equal(out.code, 502);
    assert.equal(out.body.failureTypes.gmail_403_scope, 1);
    assert.equal(out.body.failureTypes.gmail_403, 0);
    const persisted = sample.writes.at(-1);
    assert.equal(persisted.path, cases.STATE);
    assert.equal(persisted.value.pageToken, "existing-cursor");
    assert.equal(persisted.value.scanned, 10);
    assert.equal(persisted.value.lastErrorTypes.gmail_403_scope, 1);
    assert.equal(JSON.stringify(persisted.value).includes("bad-2"), false);
  } finally {
    console.error = old;
    sample.restore();
  }
});

test("Gmail adapter exposes only allowlisted reason, never provider body or customer PII", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({
      ok: false, status: 403,
      json: async () => ({ error: { message: "private customer@example.invalid token",
        errors: [{ reason: "insufficientPermissions" }] } })
    });
    await assert.rejects(gmail.message("fake-token", "synthetic-id"), err => {
      assert.equal(err.message, "Gmail request failed: 403");
      assert.equal(err.gmailReason, "insufficientPermissions");
      assert.equal(JSON.stringify(err).includes("customer@example.invalid"), false);
      return true;
    });
    globalThis.fetch = async () => ({
      ok: false, status: 403,
      json: async () => ({ error: { errors: [{ reason: "private customer@example.invalid token" }] } })
    });
    await assert.rejects(gmail.message("fake-token", "synthetic-id"), err => {
      assert.equal(err.message, "Gmail request failed: 403");
      assert.equal(err.gmailReason, undefined);
      return true;
    });
  } finally { globalThis.fetch = original; }
});


test("Gmail scope denial stops remaining fetches and retries the same page", async () => {
  const sample = fixtures({ failed: true, gmailReason: "insufficientPermissions",
    messageIds: ["ok-1", "bad-2", "must-not-fetch"] });
  const originalError = console.error;
  console.error = () => {};
  try {
    const out = response();
    await handler(sample.req, out);
    assert.equal(out.code, 502);
    assert.deepEqual(sample.messageReads, ["ok-1", "bad-2"]);
    assert.equal(out.body.counts.errors, 1);
    assert.equal(out.body.failureTypes.gmail_403_scope, 1);
    assert.equal(out.body.cursorAdvanced, false);
    assert.equal(sample.writes.filter(x => x.path.startsWith(cases.PREFIX)).length, 1);
    const written = sample.writes.at(-1);
    assert.equal(written.path, cases.STATE);
    assert.equal(written.value.pageToken, "existing-cursor");
    assert.equal(written.value.scanned, 10);
  } finally { console.error = originalError; sample.restore(); }
});

test("Gmail 403 rate-limit stops subsequent message reads without cursor loss", async () => {
  const sample = fixtures({ failed: true, gmailReason: "userRateLimitExceeded",
    messageIds: ["ok-1", "bad-2", "must-not-fetch"] });
  const originalError = console.error;
  console.error = () => {};
  try {
    const out = response();
    await handler(sample.req, out);
    assert.equal(out.code, 502);
    assert.deepEqual(sample.messageReads, ["ok-1", "bad-2"]);
    assert.equal(out.body.failureTypes.gmail_rate_limit, 1);
    assert.equal(sample.writes.at(-1).value.pageToken, "existing-cursor");
  } finally { console.error = originalError; sample.restore(); }
});
