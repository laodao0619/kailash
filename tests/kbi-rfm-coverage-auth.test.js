"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const handler = require("../api/bi-rfm-coverage");

function response() {
  return {
    code: 200,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

async function withAccessToken(value, fn) {
  const previous = process.env.KBI_ACCESS_TOKEN;
  try {
    if (value === null) delete process.env.KBI_ACCESS_TOKEN;
    else process.env.KBI_ACCESS_TOKEN = value;
    await fn();
  } finally {
    if (previous === undefined) delete process.env.KBI_ACCESS_TOKEN;
    else process.env.KBI_ACCESS_TOKEN = previous;
  }
}

const dummyToken = "test-only-placeholder-credential-not-used-in-production";

test("KBI RFM coverage fails closed if dedicated access token is missing", async () => {
  await withAccessToken(null, async () => {
    const res = response();
    await handler({ method: "GET", headers: {} }, res);
    assert.equal(res.code, 503);
    assert.deepEqual(res.body, { ok: false, error: "kbi_auth_not_configured" });
    assert.equal(res.headers["Cache-Control"], "private, no-store");
  });
});

test("KBI RFM coverage rejects missing or invalid credentials before reading data", async () => {
  await withAccessToken(dummyToken, async () => {
    for (const authorization of [undefined, "Bearer invalid", "Basic invalid"]) {
      const res = response();
      await handler({ method: "GET", headers: { authorization } }, res);
      assert.equal(res.code, 401);
      assert.deepEqual(res.body, { ok: false, error: "unauthorized" });
      assert.equal(JSON.stringify(res.body).includes(dummyToken), false);
    }
  });
});

test("KBI RFM coverage remains read-only even with a configured token", async () => {
  await withAccessToken(dummyToken, async () => {
    const res = response();
    await handler({ method: "POST", headers: { authorization: "Bearer " + dummyToken } }, res);
    assert.equal(res.code, 405);
    assert.deepEqual(res.body, { ok: false, error: "method" });
  });
});
