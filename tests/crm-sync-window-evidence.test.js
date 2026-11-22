"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
// Pure synthetic checkpoints. Blob is mocked to ensure no network/PII access.
const daily={exports:{}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,"../lib/crm-daily-state.js"),"utf8"),{
 module:daily,Date,Number,Set,Map,Buffer,process:{env:{}},
 require:name=>name==="@vercel/blob"?{get(){throw Error("Blob access in test")},put(){throw Error("Blob access in test")}}:name==="node:crypto"?require(name):undefined
});
const evidence={exports:{}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,"../lib/crm-sync-window-evidence.js"),"utf8"),{
 module:evidence,Date,Number,Map,require:name=>name==="./crm-daily-state"?daily.exports:undefined
});
const {summarizeDailyWindows}=evidence.exports;
const iso=t=>new Date(t);
function state(slot,ts,day="2026-11-22"){
 return {day,slot,slotKey:day+"/"+slot,completed:true,completedAt:ts,counters:{scanned:1},
  customerEmail:"must-not-appear@example.com"};
}
function statuses(result,slot){return result.windows.find(w=>w.slot===slot).sources;}
test("before 09:30 Beijing no empty evidence is green",()=>{
 const out=summarizeDailyWindows({},iso("2026-11-22T01:29:00Z"));
 assert.equal(out.due_checks,0);assert.equal(out.all_due_confirmed,false);assert.equal(out.all_nine_confirmed,false);
 assert.equal(statuses(out,"before_work").customers.status,"not_due");
});
test("after 09:30 only morning due; previous day cannot pass",()=>{
 const out=summarizeDailyWindows({customers:state("before_work","2026-11-21T00:51:00Z","2026-11-21")},iso("2026-11-22T01:30:00Z"));
 assert.equal(out.due_checks,3);assert.equal(out.confirmed_due_checks,0);
 assert.equal(statuses(out,"before_work").customers.status,"missing_evidence");
 assert.equal(statuses(out,"after_store_midnight").customers.status,"not_due");
});
test("morning 3/3 evidence confirmed, but afternoon not yet due",()=>{
 const morning=state("before_work","2026-11-22T00:51:00Z");
 const out=summarizeDailyWindows({customers:morning,
  orders:state("before_work","2026-11-22T00:56:00Z"),
  gmail:state("before_work","2026-11-22T01:01:00Z")},iso("2026-11-22T05:01:00Z"));
 assert.equal(out.due_checks,3);assert.equal(out.confirmed_due_checks,3);assert.equal(out.all_due_confirmed,true);assert.equal(out.all_nine_confirmed,false);
 assert.equal(statuses(out,"after_store_midnight").gmail.status,"not_due");
});
test("14:00 and 16:30 reveal missing independent sources rather than false all green",()=>{
 const am=state("before_work","2026-11-22T00:51:00Z");
 const mid=state("after_store_midnight","2026-11-22T05:17:00Z");
 const customers={...mid,slotHistory:[am]};
 const out=summarizeDailyWindows({customers,
  orders:state("before_work","2026-11-22T00:56:00Z"),
  gmail:state("before_work","2026-11-22T01:01:00Z")},iso("2026-11-22T08:30:00Z"));
 assert.equal(out.due_checks,9);assert.equal(out.confirmed_due_checks,4);assert.equal(out.all_due_confirmed,false);
 assert.equal(statuses(out,"after_store_midnight").customers.status,"confirmed");
 assert.equal(statuses(out,"after_store_midnight").orders.status,"missing_evidence");
 assert.equal(statuses(out,"before_close").customers.status,"missing_evidence");
 assert.doesNotMatch(JSON.stringify(out),/must-not-appear/);
});
test("future-dated completion is rejected and no private counters leak",()=>{
 const future=state("before_work","2026-11-24T00:51:00Z");
 const out=summarizeDailyWindows({gmail:future},iso("2026-11-22T02:00:00Z"));
 assert.equal(statuses(out,"before_work").gmail.status,"missing_evidence");
 assert.doesNotMatch(JSON.stringify(out),/scanned|customerEmail/);
});

test("a mislabeled morning completion before the source-specific cron is not accepted",()=>{
 const early=state("before_work","2026-11-22T00:51:00Z");
 const out=summarizeDailyWindows({customers:early,orders:early,gmail:early},iso("2026-11-22T02:00:00Z"));
 assert.equal(out.due_checks,3);
 assert.equal(out.confirmed_due_checks,1);
 assert.equal(statuses(out,"before_work").customers.status,"confirmed");
 assert.equal(statuses(out,"before_work").orders.status,"missing_evidence");
 assert.equal(statuses(out,"before_work").gmail.status,"missing_evidence");
});
test("afternoon and evening require their real scheduled starts, not just valid slot labels",()=>{
 const midday=state("after_store_midnight","2026-11-22T04:59:00Z");
 const evening=state("before_close","2026-11-22T07:00:00Z");
 const bad={...evening,slotHistory:[midday]};
 const out=summarizeDailyWindows({customers:bad,orders:bad,gmail:bad},iso("2026-11-22T08:35:00Z"));
 assert.equal(out.due_checks,9);
 assert.equal(out.confirmed_due_checks,0);
 for(const slot of ["after_store_midnight","before_close"]){
  for(const source of ["customers","orders","gmail"])assert.equal(statuses(out,slot)[source].status,"missing_evidence");
 }
});
test("source-specific real completion times still validate every Beijing window",()=>{
 const windows=[
  ["before_work",["2026-11-22T00:51:00Z","2026-11-22T00:56:00Z","2026-11-22T01:01:00Z"]],
  ["after_store_midnight",["2026-11-22T05:16:00Z","2026-11-22T05:21:00Z","2026-11-22T05:26:00Z"]],
  ["before_close",["2026-11-22T07:46:00Z","2026-11-22T07:51:00Z","2026-11-22T07:56:00Z"]]
 ];
 const sources={};
 ["customers","orders","gmail"].forEach((source,i)=>{
  const records=windows.map(([slot,times])=>state(slot,times[i]));
  sources[source]={...records[2],slotHistory:records.slice(0,2)};
 });
 const out=summarizeDailyWindows(sources,iso("2026-11-22T08:35:00Z"));
 assert.equal(out.all_nine_confirmed,true);
 assert.equal(out.confirmed_due_checks,9);
 assert.doesNotMatch(JSON.stringify(out),/must-not-appear/);
});
