"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {crons}=require("../vercel.json");
const expected={
 "/api/crm-daily-customers":["50 0 * * *","15 5 * * *","45 7 * * *"],
 "/api/crm-daily-orders":["55 0 * * *","20 5 * * *","50 7 * * *"],
 "/api/crm-daily-gmail":["0 1 * * *","25 5 * * *","55 7 * * *"]
};
test("three Beijing workday windows for each Shopify/Gmail delta",()=>{
 for(const [path,schedules] of Object.entries(expected)){
  const actual=crons.filter(c=>c.path===path).map(c=>c.schedule);
  assert.deepEqual(actual,schedules,path);
 }
});
test("original full customer and order imports never get scheduled again",()=>{
 const denied=["/api/crm-backfill","/api/crm-orders-stage","/api/crm-orders-reconcile","/api/crm-gmail-stage"];
 for(const entry of crons)assert.equal(denied.includes(entry.path),false,entry.path);
});
test("temporary historical Gmail completion job remains independently resumable",()=>{
 assert(crons.some(x=>x.path==="/api/crm-gmail-filtered"));
});
