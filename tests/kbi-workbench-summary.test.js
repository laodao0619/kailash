"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {summarize,TIERS}=require("../lib/kbi-workbench-summary");
const customers=[
 {tier:"S+",country:"US",subscription:"SUBSCRIBED",m180:3010,spendLifetime:9900,f180:5,ordersLifetime:9,rDays:5},
 {tier:"B",country:"DE",subscription:"NOT_SUBSCRIBED",m180:210,spendLifetime:350,f180:1,ordersLifetime:2,rDays:70},
 {tier:"待核验",country:null,subscription:null,m180:null,spendLifetime:null,f180:null,ordersLifetime:null,rDays:null}
];
test("historical CRM rollup preserves exact customer and tier counts",()=>{
 const d=summarize({customers,generatedAt:"2026-11-08T00:00:00Z",source:"Feishu CRM snapshot"});
 assert.equal(d.masterTotal,3);
 assert.equal(d.tierTotal,3);
 assert.equal(d.tiers.find(t=>t.name==="S+").count,1);
 assert.equal(d.tiers.find(t=>t.name==="B").count,1);
 assert.equal(d.tiers.find(t=>t.name==="待核验").count,1);
 assert.equal(d.tiers.reduce((sum,t)=>sum+t.count,0),3);
 assert.equal(d.topCountries.find(c=>c.name==="US").count,1);
 assert.equal(d.grading.state,"historical_snapshot_pending_full_net_reconciliation");
});
test("missing RFM values are not converted into zero, and scope is explicit",()=>{
 const d=summarize({customers});
 assert.equal(d.historical.m180.value,3220);
 assert.equal(d.historical.m180.coverage,2);
 assert.equal(d.historical.lifetime.value,10250);
 assert.equal(d.historical.lifetime.coverage,2);
 assert.equal(d.customerActivity.unknown,1);
 assert.equal(d.customerActivity.recent30,1);
 assert.equal(d.customerActivity.recent90,2);
});
test("all final standard grades appear even if empty",()=>{
 const d=summarize({customers:[]});
 assert.deepEqual(d.tiers.map(t=>t.name),TIERS);
 assert(d.tiers.every(t=>t.count===0));
 assert.equal(d.historical.m180.coverage,0);
});
