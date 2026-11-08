"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {group}=require("../lib/kbi-rfm-cube");
const make=(m,r,f,tier="B",aov=250)=>({m180:m,rDays:r,f180:f,tier,aov});
test("classifies exactly eight RFM cubes independent of S+/S/A/B grade",()=>{
 const rows=[make(1000,20,3,"B",500),make(100,20,3,"S+",100),
 make(1000,20,1,"A",300),make(100,20,1,"B",300),
 make(1000,220,3),make(100,220,3),make(1000,220,1),make(100,220,1)];
 const r=group(rows);
 assert.equal(r.classified,8);
 assert.deepEqual(r.segments.map(x=>x.count),[1,1,1,1,1,1,1,1]);
 assert.equal(r.health.rate,50);
 assert.equal(r.unknown.count,0);
});
test("filters AOV independently of grade and shows unknown M/R/F",()=>{
 const rows=[make(1500,30,5,"B",500),make(1500,30,5,"S+",500),
 make(null,30,4,"B",120),make(100,30,null,"B",120)];
 const high=group(rows,{aov:"high",tier:"B"});
 assert.equal(high.totalSelected,1);assert.equal(high.classified,1);
 const low=group(rows,{aov:"low",tier:"B"});
 assert.equal(low.totalSelected,2);assert.equal(low.unknown.count,2);
 assert.equal(low.health.rate,null);
});
test("invalid threshold fails closed and missing data is not a zero",()=>{
 assert.throws(()=>group([],{frequencyOrders:0}),/bad_rfm_thresholds/);
 const r=group([make(null,null,0),make(0,190,1)]);
 assert.equal(r.unknown.count,1);
 assert.equal(r.classified,1);
 assert.equal(r.segments.find(s=>s.code==="LLL").count,1);
});
test("model exposes historically unverified label and explains health denominator",()=>{
 const r=group([make(500,10,3),make(500,300,3)]);
 assert.equal(r.auditStatus,"not_final_full_history_net_ledger");
 assert.equal(r.health.denominator,2);
 assert.equal(r.health.rate,50);
});
