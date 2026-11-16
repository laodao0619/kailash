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
 for(const r of [0,1,181,-1,"30"]){
  const inconsistent=classify({lifetimeSpend:0,lifetimeOrders:0,f:0,r});
  assert.equal(inconsistent.grade,"待核验");
  assert.equal(inconsistent.reason,"inconsistent_never_purchased");
 }
});

test("November 12 is the unique CRM policy date; zero-net historical orders are pending",()=>{
 assert.equal(require("../lib/crm-lifetime-tier").POLICY_VERSION,"2026-11-12");
 for(const f of [0,1,2])for(const r of [null,30,200]){
  const result=classify({lifetimeSpend:0,lifetimeOrders:3,f,r});
  assert.equal(result.grade,"待核验");
  assert.equal(result.verified,false);
  assert.equal(result.reason,"zero_net_spend_with_orders");
 }
});
test("Feishu snapshot tiers stay provisional until full-history finance approval",()=>{
 const row={tier:"B",spendLifetime:5000,ordersLifetime:10,f180:1,rDays:30,m180:80};
 const graded=applyRow(row);
 assert.equal(graded.tier,"S+");
 assert.equal(graded.tierVerified,false);
 assert.equal(graded.tierRuleEvaluated,true);
 assert.equal(graded.tierAuditStatus,"pending_full_history_financial_reconciliation");
 assert.equal(graded.m180,80);
 assert.equal(row.tier,"B");
});

test("historical buyers with absent or invalid purchase recency never receive a tier or dormant status",()=>{
 for(const f of [0,1]){
  for(const r of [null,undefined,NaN,"", "200"]){
   const result=classify({lifetimeSpend:3200,lifetimeOrders:5,f,r});
   assert.equal(result.grade,"待核验");
   assert.equal(result.verified,false);
   assert.equal(result.reason,"activity_mismatch");
  }
 }
 const missing=applyRow({spendLifetime:4000,ordersLifetime:7,f180:0});
 assert.equal(missing.tier,"待核验");
 assert.equal(missing.tierVerified,false);
 assert.equal(missing.tierRuleEvaluated,false);
 // Complete recency is still sufficient for genuinely dormant buyers.
 assert.equal(classify({lifetimeSpend:3200,lifetimeOrders:5,f:0,r:181}).grade,"沉睡");
});
