"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { historicalImportEnabled } = require("../lib/crm-gmail-historical-retirement");

test("completed historical import stays retired by default", () => {
  for (const env of [{}, {CRM_GMAIL_HISTORICAL_IMPORT_ENABLED:"false"},
    {CRM_GMAIL_HISTORICAL_IMPORT_ENABLED:"TRUE"},
    {CRM_GMAIL_HISTORICAL_IMPORT_ENABLED:true},
    {CRM_FILTER_VERSION:"v2-reviewed"}]) {
    assert.equal(historicalImportEnabled(env), false);
  }
});

test("explicit admin opt-in is required to enable the legacy endpoint", () => {
  assert.equal(historicalImportEnabled({CRM_GMAIL_HISTORICAL_IMPORT_ENABLED:"true"}), true);
});

test("legacy route authenticates then retires before touching historical state or Gmail", () => {
  const route = fs.readFileSync(path.join(__dirname, "../api/crm-gmail-filtered.js"), "utf8");
  const auth = route.indexOf("if(!authorized(req))");
  const gate = route.indexOf("if(!historicalImportEnabled(process.env))");
  const read = route.indexOf("const state=await readState()");
  const token = route.indexOf("await gmail.token()");
  assert.ok(auth >= 0 && gate > auth && read > gate && token > gate);
  assert.match(route, /checkpointAdvanced:\s*false/);
});
