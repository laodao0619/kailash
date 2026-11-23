"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const cases = require("../lib/crm-cases");
const handler = require("../api/crm-cases-feishu");

function response() {
  return {
    code: null, body: null,
    setHeader() {},
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test("preview schema token cannot inspect private Case archive or event content", async () => {
  const oldEnv = process.env.VERCEL_ENV;
  const oldToken = process.env.CRM_CASE_PREFLIGHT_TOKEN;
  const oldAuth = cases.authorized;
  const token = "schema-only-preview-credential-32characters";
  cases.authorized = () => false;
  try {
    process.env.VERCEL_ENV = "preview";
    process.env.CRM_CASE_PREFLIGHT_TOKEN = token;
    for (const action of ["auditArchive", "auditContent"]) {
      const res = response();
      await handler({
        method: "GET",
        headers: {authorization: "Bearer " + token},
        query: {dryRun: "1", [action]: "1"},
      }, res);
      assert.equal(res.code, 403, action + " must not accept preview schema token");
      assert.equal(res.body.ok, false);
      assert.equal(res.body.checkpointAdvanced, false);
      assert.equal(res.body.blockedReason,
        action === "auditArchive" ? "case_archive_audit_not_authorized" :
          "case_content_audit_not_authorized");
    }
  } finally {
    cases.authorized = oldAuth;
    if (oldEnv === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = oldEnv;
    if (oldToken === undefined) delete process.env.CRM_CASE_PREFLIGHT_TOKEN;
    else process.env.CRM_CASE_PREFLIGHT_TOKEN = oldToken;
  }
});
