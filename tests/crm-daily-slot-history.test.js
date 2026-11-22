"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const path=require("node:path");
const mod={exports:{}};
const src=fs.readFileSync(path.join(__dirname,"../lib/crm-daily-state.js"),"utf8");
// Mock all Blob I/O: synthetic checkpoints only, no Shopify/Feishu calls.
vm.runInNewContext(src,{module:mod,require(name){
 if(name==="@vercel/blob")return {get:()=>{throw Error("No Blob I/O in unit test")},put:()=>{throw Error("No Blob I/O in unit test")}};
 if(name==="node:crypto")return require("node:crypto");
 throw Error(name);
},Date,Number,Set,Map,Buffer,process:{env:{}},console},{filename:"crm-daily-state.js"});
const {cycle,done,slotHistory}=mod.exports;
const at=s=>new Date(s);
const morning=at("2026-11-22T00:50:00Z");
const midday=at("2026-11-22T05:15:00Z");
const evening=at("2026-11-22T07:45:00Z");

test("retains all three Beijing windows with per-slot numeric evidence",()=>{
 const a=cycle(null,morning);a.counters.scanned=27;done(a,at("2026-11-22T00:51:00Z"));
 const b=cycle(a,midday);b.counters.scanned=21;done(b,at("2026-11-22T05:17:00Z"));
 const c=cycle(b,evening);c.counters.scanned=19;done(c,at("2026-11-22T07:47:00Z"));
 assert.deepEqual([...slotHistory(c)].map(s=>s.slot),["before_work","after_store_midnight","before_close"]);
 assert.deepEqual([...slotHistory(c)].map(s=>s.counters.scanned),[27,21,19]);
 assert.equal(c.cursor,null);
 assert.equal(c.day,"2026-11-22");
});
test("unfinished cursor and prior evidence survive the next window",()=>{
 const a=done(cycle(null,morning),at("2026-11-22T00:51:00Z"));
 const b=cycle(a,midday);b.cursor="opaque-next-page";b.counters.scanned=6;
 assert.equal(cycle(b,evening),b);
 assert.equal(b.cursor,"opaque-next-page");
 assert.deepEqual([...slotHistory(b)].map(s=>s.slot),["before_work"]);
});
test("legacy completed checkpoints upgrade without duplicated windows",()=>{
 const legacy={day:"2026-11-22",slot:"before_work",slotKey:"2026-11-22/before_work",completed:true,
  startedAt:"2026-11-22T00:50:00Z",completedAt:"2026-11-22T00:51:00Z",counters:{scanned:27}};
 const next=cycle(legacy,midday);
 assert.equal(next.slotHistory.length,1);
 done(next,at("2026-11-22T05:17:00Z"));
 assert.equal(slotHistory(next).length,2);
 done(next,at("2026-11-22T05:18:00Z"));
 assert.equal(slotHistory(next).length,2);
});
test("bounded evidence strips malformed and customer fields",()=>{
 let checkpoint=null;
 for(let n=0;n<15;n++){
  const day=String(1+n).padStart(2,"0");
  checkpoint=cycle(checkpoint,at("2026-11-"+day+"T00:50:00Z"));
  checkpoint.counters.scanned=n;
  done(checkpoint,at("2026-11-"+day+"T00:51:00Z"));
 }
 assert.equal(slotHistory(checkpoint).length,12);
 assert.equal(slotHistory(checkpoint)[0].day,"2026-11-04");
 const malformed={...checkpoint,slotHistory:[{completed:true,day:"2026-11-22",slot:"bad",slotKey:"bad",completedAt:"invalid",email:"private@example.com"}]};
 const clean=slotHistory(malformed);
 assert.equal(clean.length,1);
 assert.doesNotMatch(JSON.stringify(clean),/private@example.com/);
});
