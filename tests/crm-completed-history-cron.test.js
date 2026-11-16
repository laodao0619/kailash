"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const config = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "vercel.json"), "utf8"));
const crons = config.crons || [];
const schedules = route => crons.filter(job => job.path === route).map(job => job.schedule).sort();

test("completed historical Gmail backfill no longer has an automatic trigger", () => {
  // The production /api/crm-status imports.gmail.completed flag was
  // independently read as true on 2026-11-14. Do not re-enable this cron
  // in a future config change; retain the route for manually authorized diagnosis.
  assert.deepEqual(schedules("/api/crm-gmail-filtered"), []);
});

test("three daily delta windows remain unchanged for every channel", () => {
  const expected = {
    "/api/crm-daily-customers": ["50 0 * * *", "15 5 * * *", "45 7 * * *"],
    "/api/crm-daily-orders": ["55 0 * * *", "20 5 * * *", "50 7 * * *"],
    "/api/crm-daily-gmail": ["0 1 * * *", "25 5 * * *", "55 7 * * *"],
  };
  for (const [route, times] of Object.entries(expected)) {
    assert.deepEqual(schedules(route), times.sort(), route);
  }
});

test("existing Case processing and BI QA are still scheduled", () => {
  const expected = {
    "/api/crm-cases-sync": ["15,45 * * * *"],
    "/api/crm-cases-feishu": ["20,50 * * * *"],
    "/api/crm-case-private-preview": ["*/5 * * * *"],
    "/api/bi-index-build": ["*/5 * * * *"],
    "/api/bi-production-qa": ["*/5 * * * *"],
    "/api/bi-ops-dashboard": ["0,30 * * * *"],
    "/api/crm-worker": ["0 0 * * *"],
  };
  for (const [route, times] of Object.entries(expected)) {
    assert.deepEqual(schedules(route), times, route);
  }
});
