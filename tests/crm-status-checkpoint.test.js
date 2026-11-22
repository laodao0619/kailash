"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { readCheckpoint } = require("../lib/crm-status-checkpoint");
const stream = async function* (...parts) { for (const part of parts) yield Buffer.from(part); };
test("private checkpoint read preserves actual parsed payload", async () => {
  let args;
  const get = async (...a) => { args = a; return { statusCode: 200, stream: stream('{"day":', '"2026-11-22","completed":true}') }; };
  assert.deepEqual(await readCheckpoint(get, "private-state.json"), { day: "2026-11-22", completed: true });
  assert.deepEqual(args, ["private-state.json", { access: "private" }]);
});
test("only missing checkpoint returns null", async () => {
  assert.equal(await readCheckpoint(async () => null, "missing"), null);
  assert.equal(await readCheckpoint(async () => ({ statusCode: 404 }), "missing"), null);
});
for (const statusCode of [401, 403, 429, 500, 503]) {
  test(`private Blob status ${statusCode} fails closed`, async () => {
    await assert.rejects(() => readCheckpoint(async () => ({ statusCode }), "state"), /unavailable/);
  });
}
test("missing stream on a 200 is not treated as empty state", async () => {
  await assert.rejects(() => readCheckpoint(async () => ({ statusCode: 200 }), "state"), /unavailable/);
});
test("corrupt JSON does not become an empty checkpoint", async () => {
  await assert.rejects(() => readCheckpoint(async () => ({ statusCode: 200, stream: stream("{") }), "state"), SyntaxError);
});
test("non-object JSON is invalid checkpoint", async () => {
  await assert.rejects(() => readCheckpoint(async () => ({ statusCode: 200, stream: stream("false") }), "state"), /malformed/);
});
test("oversized checkpoint fails without continuing to parse", async () => {
  await assert.rejects(() => readCheckpoint(async () => ({ statusCode: 200, stream: stream("xxxxxx") }), "state", 5), /too large/);
});
