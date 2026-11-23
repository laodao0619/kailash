"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {classify,applyRow}=require("../lib/crm-lifetime-tier");
const {queryRows}=require("../api/bi-customers-v2");
const {matches}=require("../lib/kbi-audience");
const {group}=require("../lib/kbi-rfm-cube");
const {toCSV}=require("../api/bi-customers-export");
test("existing cached labels migrate consistently across filters, audience, cube and export",()=>{
 const row={id:"123456",email:"customer@real.com",quality:"有效",subscription:"已订阅",
  tier:"B",spendLifetime:5000,ordersLifetime:10,f180:1,rDays:100,m180:100,aov:500};
 const fresh=applyRow(row);
 assert.equal(fresh.tier,"S+");
 assert.equal(queryRows([fresh],{tier:"S+"}).length,1);
 assert.deepEqual(matches([fresh],{tier:"S+"}).ids,["123456"]);
 const cube=group([fresh],{tier:"S+"});
 assert.equal(cube.classified,1);
 assert.equal(cube.segments.find(x=>x.code==="LLL").count,1);
 assert(toCSV([fresh]).includes('"S+"'));
 assert.equal(fresh.m180,100);assert.equal(fresh.f180,1);
 assert.equal(row.tier,"B");
});
test("incomplete lifetime or activity metrics stay pending and contradictory snapshots do not grade",()=>{
 for(const patch of [{lifetimeSpend:null},{f:null},{lifetimeOrders:null},{r:190},{f:11}])
  assert.equal(classify({lifetimeSpend:5000,lifetimeOrders:10,f:1,r:100,...patch}).grade,"待核验");
 assert.equal(classify({lifetimeSpend:5000,lifetimeOrders:10,f:0,r:181}).grade,"沉睡");
 assert.equal(classify({lifetimeSpend:0,lifetimeOrders:0,f:0,r:null}).grade,"从未购买");
});

// Regression: historical order exists, but net lifetime spend is exactly zero.
// This must never create a separately graded "基础客户" or "沉睡" account.
test("zero lifetime net spend with purchases always requires review",()=>{
 for(const activity of [{f:1,r:10},{f:0,r:200},{f:1,r:null}]){
  const result=classify({lifetimeSpend:0,lifetimeOrders:3,...activity});
  assert.equal(result.grade,"待核验");
  assert.equal(result.verified,false);
  assert.equal(result.reason,"zero_net_spend_with_orders");
 }
 const row=applyRow({id:"12345",tier:"B",spendLifetime:0,ordersLifetime:3,f180:1,rDays:10,m180:0});
 assert.equal(row.tier,"待核验");
 assert.equal(row.tierVerified,false);
});
test("2026-11-12 lifetime USD boundaries use one recent order, independently of M180",()=>{
 const examples=[[0.01,"B"],[799.99,"B"],[800,"A"],[1499.99,"A"],[1500,"S"],[2999.99,"S"],[3000,"S+"]];
 for(const [lifetimeSpend,tier] of examples){
  assert.equal(classify({lifetimeSpend,lifetimeOrders:10,f:1,r:170}).grade,tier);
  assert.equal(classify({lifetimeSpend,lifetimeOrders:10,f:0,r:181}).grade,"沉睡");
 }
 assert.equal(classify({lifetimeSpend:0,lifetimeOrders:0,f:0,r:null}).grade,"从未购买");
 const {POLICY_VERSION}=require("../lib/crm-lifetime-tier");
 assert.equal(POLICY_VERSION,"2026-11-12");
});
