"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {expectedWindow,evaluateDailyHealth}=require("../lib/crm-delta-health");
function checkpoint(day,slot,completed=true){
 return {day,slotKey:day+"/"+slot,completed,updatedAt:day+"T01:00:00.000Z"};
}
const day="2026-11-21",morning=checkpoint(day,"before_work");
test("before Beijing 09:30 is not due",()=>{
 const data=evaluateDailyHealth(null,new Date("2026-11-21T01:29:59Z"));
 assert.equal(data.day,day);assert.equal(data.slot,null);
 assert.equal(data.sources.gmail.status,"not_due");assert.equal(data.ready,false);
});
test("Beijing 09:30/14:00/16:30 checks use separate expected slots",()=>{
 assert.equal(expectedWindow(new Date("2026-11-21T01:30:00Z")).slot,"before_work");
 assert.equal(expectedWindow(new Date("2026-11-21T06:00:00Z")).slot,"after_store_midnight");
 assert.equal(expectedWindow(new Date("2026-11-21T08:30:00Z")).slot,"before_close");
 assert.equal(expectedWindow(new Date("2026-11-20T16:01:00Z")).day,day);
});
test("yesterday completed Gmail does not pass today",()=>{
 const data=evaluateDailyHealth({customers:morning,orders:morning,
  gmail:checkpoint("2026-11-20","before_close")},new Date("2026-11-21T04:03:42Z"));
 assert.equal(data.sources.customers.status,"completed");
 assert.equal(data.sources.orders.status,"completed");
 assert.equal(data.sources.gmail.status,"stale_day");assert.equal(data.ready,false);
});
test("morning completion cannot pass 14:00 later slot check",()=>{
 const data=evaluateDailyHealth({customers:morning,orders:morning,gmail:morning},new Date("2026-11-21T06:01:00Z"));
 assert.equal(data.slot,"after_store_midnight");assert.equal(data.sources.gmail.status,"stale_slot");
 assert.equal(data.ready,false);
});
test("missing slot cannot be marked verified",()=>{
 const data=evaluateDailyHealth({gmail:{day,completed:true}},new Date("2026-11-21T04:03:42Z"));
 assert.equal(data.sources.gmail.status,"unverified_slot");
 assert.equal(data.sources.customers.status,"missing");
});
test("same-slot incomplete does not pass and cursor is unchanged",()=>{
 const original=checkpoint(day,"before_work",false),before=structuredClone(original);
 const data=evaluateDailyHealth({customers:original,orders:morning,gmail:morning},new Date("2026-11-21T04:03:42Z"));
 assert.equal(data.sources.customers.status,"incomplete");
 assert.equal(data.ready,false);assert.deepEqual(original,before);
});
test("all three completed from today required slot pass",()=>{
 const data=evaluateDailyHealth({customers:morning,orders:morning,gmail:morning},new Date("2026-11-21T04:03:42Z"));
 assert.equal(data.ready,true);
});
