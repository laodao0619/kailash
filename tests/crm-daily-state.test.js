"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {cycle,done,beijingSlot}=require("../lib/crm-daily-state");
const start="2026-11-08T00:50:00.000Z"; // Beijing 08:50
test("three separate Beijing business-day windows are selected correctly",()=>{
 const m=beijingSlot(new Date("2026-11-08T00:50:00Z"));
 const n=beijingSlot(new Date("2026-11-08T05:15:00Z"));
 const e=beijingSlot(new Date("2026-11-08T07:45:00Z"));
 assert.deepEqual([m.slot,n.slot,e.slot],["before_work","after_store_midnight","before_close"]);
 assert.equal(m.day,"2026-11-08");
 assert.equal(n.day,m.day);
 assert.equal(e.day,m.day);
});
test("first sync runs a 49-hour bounded lookback, not a historical import",()=>{
 const v=cycle(null,new Date(start));
 assert.equal(v.day,"2026-11-08");
 assert.equal(v.slot,"before_work");
 assert.equal(v.windowStart,"2026-11-05T23:50:00.000Z");
 assert.equal(v.cursor,null);
 assert.equal(v.completed,false);
});
test("same window completed invocation is idempotent",()=>{
 const v=done(cycle(null,new Date(start)),new Date("2026-11-08T00:52:00Z"));
 assert.strictEqual(cycle(v,new Date("2026-11-08T01:03:00Z")),v);
});
test("second and third Beijing windows run even after same-day completion",()=>{
 const morning=done(cycle(null,new Date(start)),new Date("2026-11-08T00:52:00Z"));
 const afterMidnight=cycle(morning,new Date("2026-11-08T05:15:00Z"));
 assert.equal(afterMidnight.slot,"after_store_midnight");
 assert.equal(afterMidnight.day,morning.day);
 assert.equal(afterMidnight.windowStart,"2026-11-07T23:52:00.000Z");
 const noonDone=done(afterMidnight,new Date("2026-11-08T05:17:00Z"));
 const beforeClose=cycle(noonDone,new Date("2026-11-08T07:45:00Z"));
 assert.equal(beforeClose.slot,"before_close");
 assert.equal(beforeClose.windowStart,"2026-11-08T04:17:00.000Z");
});
test("next Beijing workday starts a distinct slot even when it is UTC previous date",()=>{
 const prior=done(cycle(null,new Date("2026-11-08T07:45:00Z")),new Date("2026-11-08T07:47:00Z"));
 const tomorrow=cycle(prior,new Date("2026-11-09T00:50:00Z"));
 assert.equal(tomorrow.day,"2026-11-09");
 assert.equal(tomorrow.slot,"before_work");
 assert.equal(tomorrow.windowStart,"2026-11-08T06:47:00.000Z");
});
test("unfinished run retains cursor even when a new business window begins",()=>{
 const v=cycle(null,new Date(start));v.cursor="opaque-shopify-next-page";
 const next=cycle(v,new Date("2026-11-08T07:45:00Z"));
 assert.strictEqual(next,v);
 assert.equal(next.cursor,"opaque-shopify-next-page");
});
test("Beijing calendar date is used even before UTC midnight",()=>{
 const local=beijingSlot(new Date("2026-11-08T17:00:00Z")); // Beijing Nov 9 01:00
 assert.equal(local.day,"2026-11-09");
});
