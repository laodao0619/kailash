"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const config = require("../vercel.json");

const entries = config.crons || [];
const schedules = path => entries.filter(cron => cron.path === path).map(cron => cron.schedule).sort();

test("completed historical Gmail import is no longer scheduled", () => {
  assert.deepEqual(schedules("/api/crm-gmail-filtered"), []);
});

test("all three existing Beijing daily customer, order and Gmail windows remain unchanged", () => {
  const windows = {
    customers: ["50 0 * * *", "15 5 * * *", "45 7 * * *"],
    orders: ["55 0 * * *", "20 5 * * *", "50 7 * * *"],
    gmail: ["0 1 * * *", "25 5 * * *", "55 7 * * *"],
  };
  for (const [source, expected] of Object.entries(windows)) {
    assert.deepEqual(schedules("/api/crm-daily-" + source), expected.sort());
  }
});

test("Case processing and customer support reminders stay scheduled", () => {
  assert.deepEqual(schedules("/api/crm-cases-sync"), ["15,45 * * * *"]);
  assert.deepEqual(schedules("/api/crm-cases-feishu"), ["20,50 * * * *"]);
  assert.deepEqual(schedules("/api/crm-worker"), ["0 0 * * *"]);
});

test("retiring historical Gmail does not introduce Bulk import or repeated historical jobs", () => {
  const forbidden = new Set([
    "/api/crm-orders-bulk", "/api/crm-orders-bulk-audit",
  ]);
  assert.equal(entries.some(x => forbidden.has(x.path)), false);
});
