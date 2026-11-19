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

test("recorded orders with zero historical net USD stay pending, never B/dormant",()=>{
 for(const sample of [
  {lifetimeSpend:0,lifetimeOrders:3,f:1,r:30},
  {lifetimeSpend:0,lifetimeOrders:3,f:0,r:200},
  {lifetimeSpend:0,lifetimeOrders:3,f:0,r:null}
 ]){
  const result=classify(sample);
  assert.equal(result.grade,"待核验");
  assert.equal(result.verified,false);
  assert.equal(result.reason,"orders_with_zero_lifetime_spend");
 }
 const row={tier:"B",spendLifetime:0,ordersLifetime:3,f180:1,rDays:30,m180:500};
 const recalculated=applyRow(row);
 assert.equal(recalculated.tier,"待核验");
 assert.equal(recalculated.tierVerified,false);
 assert.equal(recalculated.m180,500); // RFM remains independent of grade
 assert.equal(row.tier,"B"); // do not overwrite source snapshot
 assert.equal(classify({lifetimeSpend:0,lifetimeOrders:0,f:0,r:null}).grade,"从未购买");
 assert.equal(classify({lifetimeSpend:0.01,lifetimeOrders:1,f:1,r:10}).grade,"B");
});
