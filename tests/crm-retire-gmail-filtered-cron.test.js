"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const config = require("../vercel.json");
const crons = config.crons;

const schedules = name => crons.filter(c => c.path === name).map(c => c.schedule).sort();

test("completed historical Gmail import has no high-frequency cron", () => {
  assert.deepEqual(schedules("/api/crm-gmail-filtered"), []);
  assert.ok(fs.existsSync(path.join(__dirname, "../api/crm-gmail-filtered.js")), "manual protected route remains available");
});

test("three operational Gmail delta slots are unchanged", () => {
  assert.deepEqual(schedules("/api/crm-daily-gmail"), ["0 1 * * *", "25 5 * * *", "55 7 * * *"].sort());
});

test("customer and order delta slots remain unchanged", () => {
  assert.deepEqual(schedules("/api/crm-daily-customers"), ["50 0 * * *", "15 5 * * *", "45 7 * * *"].sort());
  assert.deepEqual(schedules("/api/crm-daily-orders"), ["55 0 * * *", "20 5 * * *", "50 7 * * *"].sort());
});

test("Case safety and BI quality crons remain unchanged", () => {
  assert.deepEqual(schedules("/api/crm-cases-sync"), ["15,45 * * * *"]);
  assert.deepEqual(schedules("/api/crm-cases-feishu"), ["20,50 * * * *"]);
  assert.deepEqual(schedules("/api/bi-production-qa"), ["*/5 * * * *"]);
  assert.deepEqual(schedules("/api/bi-index-build"), ["*/5 * * * *"]);
});
