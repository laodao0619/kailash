"use strict";
// 2026-11-23: Production /api/crm-status confirmed the historical Gmail
// import finished on 2026-11-09 (seen=19317, created=1875).
// Do not schedule this completed backfill repeatedly. Its endpoint remains
// available for separately authorized manual diagnostics; do not reset cursors.
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const config=JSON.parse(fs.readFileSync(path.join(__dirname,"../vercel.json"),"utf8"));
const entries=config.crons;
test("completed historical Gmail import is not scheduled",()=>{
 assert.equal(entries.filter(x=>x.path==="/api/crm-gmail-filtered").length,0);
});
test("all three daily Gmail incremental windows are preserved",()=>{
 assert.deepEqual(entries.filter(x=>x.path==="/api/crm-daily-gmail").map(x=>x.schedule).sort(),
  ["0 1 * * *","25 5 * * *","55 7 * * *"].sort());
});
test("Shopify customer/order windows and service reminders remain scheduled",()=>{
 for(const [route,times] of [
  ["/api/crm-daily-customers",["50 0 * * *","15 5 * * *","45 7 * * *"]],
  ["/api/crm-daily-orders",["55 0 * * *","20 5 * * *","50 7 * * *"]],
  ["/api/crm-cases-sync",["15,45 * * * *"]],
  ["/api/crm-cases-feishu",["20,50 * * * *"]]]) {
  assert.deepEqual(entries.filter(x=>x.path===route).map(x=>x.schedule).sort(),times.sort());
 }
});
