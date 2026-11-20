"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { qaCoverage, REQUIRED_CHECKS } = require("../lib/bi-qa-freshness");

const snapshot = {
  version: 2, total: 10917, generatedAt: "2026-11-20T05:45:25.098Z"
};
const qa = {
  ready: true, at: "2026-11-20T05:46:00.000Z",
  metrics: { total: 10917 },
  checks: Object.fromEntries(REQUIRED_CHECKS.map(key => [key, true]))
};

test("complete QA later than matching customer index is current technical evidence only", () => {
  assert.deepEqual(qaCoverage(snapshot, qa), {
    freshForSnapshot: true, reason: "qa_covers_current_snapshot"
  });
});
test("current production mismatch (10917 index vs 10914 previously tested) fails closed", () => {
  const old = { ...qa, at: "2026-11-20T04:00:16.382Z", metrics: { total: 10914 } };
  assert.deepEqual(qaCoverage(snapshot, old), {
    freshForSnapshot: false, reason: "qa_snapshot_count_mismatch"
  });
});
test("a same-count QA that predates index rebuilding is stale", () => {
  assert.equal(qaCoverage(snapshot, { ...qa, at: "2026-11-20T04:00:16.382Z" }).reason,
    "qa_predates_snapshot");
});
test("a READY flag cannot hide an omitted customer or RFM check", () => {
  const checks = { ...qa.checks };
  delete checks.noteRead;
  assert.equal(qaCoverage(snapshot, { ...qa, checks }).reason, "qa_checks_incomplete");
  assert.equal(qaCoverage(snapshot, { ...qa, checks: { ...checks, noteRead: false } }).freshForSnapshot, false);
});
test("failed QA, absent index, and absent QA remain blocked", () => {
  assert.equal(qaCoverage(snapshot, { ...qa, ready: false }).reason, "qa_unavailable_or_failed");
  assert.equal(qaCoverage(snapshot, null).freshForSnapshot, false);
  assert.equal(qaCoverage(null, qa).reason, "snapshot_unavailable");
});
test("malformed counts never silently coerce from numeric strings", () => {
  assert.equal(qaCoverage({ ...snapshot, total: "10917" }, qa).reason, "qa_snapshot_count_mismatch");
  assert.equal(qaCoverage(snapshot, { ...qa, metrics: { total: "10917" } }).freshForSnapshot, false);
});
test("timestamps and snapshot versions must be explicit", () => {
  assert.equal(qaCoverage(snapshot, { ...qa, at: "wrong" }).reason, "qa_timestamp_invalid");
  assert.equal(qaCoverage({ ...snapshot, generatedAt: null }, qa).freshForSnapshot, false);
  assert.equal(qaCoverage({ ...snapshot, version: 1 }, qa).reason, "snapshot_unavailable");
});
