"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const config = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));
const cronEntries = config.crons || [];

test("completed historical filtered Gmail import no longer has a repeating cron", () => {
  assert.equal(cronEntries.filter(c => c.path === "/api/crm-gmail-filtered").length, 0);
  assert.equal(fs.existsSync(path.join(root, "api/crm-gmail-filtered.js")), true,
    "retain the CRON_SECRET-protected historical endpoint for authorized recovery");
});

test("all three existing Gmail daily incremental windows remain scheduled", () => {
  const schedules = cronEntries.filter(c => c.path === "/api/crm-daily-gmail")
    .map(c => c.schedule).sort();
  assert.deepEqual(schedules, ["0 1 * * *", "25 5 * * *", "55 7 * * *"].sort());
  assert.equal(fs.existsSync(path.join(root, "api/crm-daily-gmail.js")), true);
});

test("Shopify daily deltas, Case sync and operational checks stay scheduled", () => {
  for (const [endpoint, schedules] of [
    ["/api/crm-daily-customers", ["50 0 * * *", "15 5 * * *", "45 7 * * *"]],
    ["/api/crm-daily-orders", ["55 0 * * *", "20 5 * * *", "50 7 * * *"]],
    ["/api/crm-cases-sync", ["15,45 * * * *"]],
    ["/api/crm-cases-feishu", ["20,50 * * * *"]],
    ["/api/bi-index-build", ["*/5 * * * *"]],
    ["/api/bi-production-qa", ["*/5 * * * *"]]
  ]) {
    const actual = cronEntries.filter(c => c.path === endpoint).map(c => c.schedule).sort();
    assert.deepEqual(actual, schedules.sort(), endpoint);
  }
});

test("one cron removal only; no changes to function duration or other schedules", () => {
  assert.equal(config.functions["api/**/*.js"].maxDuration, 120);
  assert.equal(cronEntries.length, 17);
  assert.equal(cronEntries.every(c => c.path && c.schedule), true);
});
