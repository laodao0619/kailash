"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {grade,aovGroup}=require("../lib/kbi-rfm");
const base={asOfDate:"2026-11-08",M:3200,lifetimeSpendUSD:3200,F:5,
 latestValidOrderDate:"2026-11-01",lifetimeValidOrders:9,
 historyComplete:true,financialReconciled:true,currency:"USD"};
function g(overrides){return grade({...base,...overrides});}
test("lifetime boundaries apply with just one recent order and no 45/90 day gate",()=>{
 for(const [l,tier] of [[3000,"S+"],[2999.99,"S"],[1500,"S"],[1499.99,"A"],[800,"A"],[799.99,"B"],[0.01,"B"]]){
  assert.equal(g({lifetimeSpendUSD:l,M:0.01,F:1,latestValidOrderDate:"2026-05-12"}).tier,tier);
 }
 assert.equal(g({lifetimeSpendUSD:5000,M:20,F:1}).tier,"S+");
 assert.equal(g({lifetimeSpendUSD:0,M:0,F:1}).status,"unverified");
});
test("at exactly 180 days a customer can still be active; after 180 dormant",()=>{
 assert.equal(g({M:800,F:2,latestValidOrderDate:"2026-05-12"}).R,180);
 assert.equal(g({M:0,F:0,latestValidOrderDate:"2026-05-11"}).tier,"沉睡");
});
test("never purchased is separate from dormant and unknown",()=>{
 assert.equal(g({lifetimeSpendUSD:0,M:0,F:0,latestValidOrderDate:null,lifetimeValidOrders:0}).tier,"从未购买");
 assert.equal(g({M:0,F:0,latestValidOrderDate:null,lifetimeValidOrders:1}).status,"unverified");
});
test("missing order or financial verification stays unknown, never zero",()=>{
 for(const patch of [
  {historyComplete:false},{financialReconciled:false},{currency:"EUR"},
  {M:null},{lifetimeSpendUSD:null},{F:null},{lifetimeValidOrders:null},
  {latestValidOrderDate:"not a date"},{latestValidOrderDate:"2026-11-09"},
  {M:100,F:3,lifetimeValidOrders:2}
 ]){
  const got=g(patch);
  assert.equal(got.status,"unverified");
  assert.equal(got.tier,null);
 }
});
test("stale activity and money mismatches are rejected, not graded",()=>{
 assert.equal(g({M:99,F:2,latestValidOrderDate:"2026-04-01"}).status,"unverified");
 assert.equal(g({M:0,F:0,latestValidOrderDate:"2026-11-01"}).status,"unverified");
});
test("AOV cohort separate from CRM tier, no inferred value",()=>{
 assert.equal(aovGroup(400,{verified:true}),"高客单价");
 assert.equal(aovGroup(399.99,{verified:true}),"低客单价");
 assert.equal(aovGroup(400),null);
});
