"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {crons}=require("../vercel.json");

function schedules(route){
 return crons.filter(entry=>entry.path===route).map(entry=>entry.schedule).sort();
}
test("completed historical Gmail import is no longer repeatedly scheduled",()=>{
 assert.deepEqual(schedules("/api/crm-gmail-filtered"),[]);
 // Keep the route and its preserved private cursor for explicit, authorized
 // recovery; only its temporary every-ten-minute schedule is retired.
 assert.equal(fs.existsSync(path.join(__dirname,"../api/crm-gmail-filtered.js")),true);
});
test("all nine Beijing-time daily customer/order/Gmail checkpoints stay intact",()=>{
 assert.deepEqual(schedules("/api/crm-daily-customers"),[
  "15 5 * * *","45 7 * * *","50 0 * * *"
 ].sort());
 assert.deepEqual(schedules("/api/crm-daily-orders"),[
  "20 5 * * *","50 7 * * *","55 0 * * *"
 ].sort());
 assert.deepEqual(schedules("/api/crm-daily-gmail"),[
  "0 1 * * *","25 5 * * *","55 7 * * *"
 ].sort());
});
test("all Case, BI, report, private preview and worker jobs remain untouched",()=>{
 const preserved={
  "/api/crm-case-private-preview":"*/5 * * * *",
  "/api/crm-worker":"0 0 * * *",
  "/api/crm-cases-sync":"15,45 * * * *",
  "/api/crm-cases-feishu":"20,50 * * * *",
  "/api/bi-index-build":"*/5 * * * *",
  "/api/bi-production-qa":"*/5 * * * *",
  "/api/bi-ops-dashboard":"0,30 * * * *",
  "/api/bi-crm-report":"30 5 * * *"
 };
 for(const [route,schedule] of Object.entries(preserved)){
  assert.deepEqual(schedules(route),[schedule],route);
 }
 assert.equal(crons.length,17);
 assert.equal(new Set(crons.map(x=>x.path+"|"+x.schedule)).size,crons.length);
});
