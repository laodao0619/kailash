"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {classify,applyRow,fromFields,POLICY_VERSION}=require("../lib/crm-tier-policy");
const {queryRows,facets}=require("../api/bi-customers-v2");
const {group}=require("../lib/kbi-rfm-cube");
const {matches}=require("../lib/kbi-audience");
test("new tiers have exact inclusive lower and exclusive upper money boundaries",()=>{
 for(const [money,tier] of [[0.01,"B"],[799.99,"B"],[800,"A"],[1499.99,"A"],[1500,"S"],[2999.99,"S"],[3000,"S+"],[10000,"S+"]]){
  assert.equal(classify({lifetimeSpendUSD:money,f180:1}).tier,tier);
  assert.equal(classify({lifetimeSpendUSD:money,f180:0}).tier,"沉睡");
 }
 for(const f180 of [null,undefined,-1,0.5,NaN])assert.equal(classify({lifetimeSpendUSD:3000,f180}).tier,"待核验");
 for(const lifetimeSpendUSD of [null,undefined,-1,NaN,0])assert.equal(classify({lifetimeSpendUSD,f180:1}).tier,"待核验");
 assert.equal(classify({lifetimeSpendUSD:0,f180:0,ordersLifetime:0}).tier,"从未购买");
 assert.equal(classify({lifetimeSpendUSD:3000,f180:2,ordersLifetime:1}).tier,"待核验");
});
test("cached old grade is recalculated before list facets, RFM filter and saved audience matching",()=>{
 const c=applyRow({id:"123456",email:"customer@realmail.com",quality:"有效",subscription:"已订阅",tier:"B",spendLifetime:3200,ordersLifetime:8,m180:20,f180:1,rDays:170,aov:400});
 assert.equal(c.tier,"S+");assert.equal(c.sourceTier,"B");assert.equal(c.tierPolicyVersion,POLICY_VERSION);
 assert.equal(applyRow(c).sourceTier,"B");assert.equal(c.tierVerified,false);
 assert.equal(queryRows([c],{tier:"S+"}).length,1);assert.equal(facets([c]).tiers[0].value,"S+");
 const r=group([c],{tier:"S+"});assert.equal(r.totalSelected,1);
 assert.equal(r.segments.find(x=>x.code==="LLL").count,1); // low recent behaviour can still be S+
 assert.equal(r.tierPolicyVersion,POLICY_VERSION);
 assert.deepEqual(matches([c],{tier:"S+"}).ids,[c.id]);
});
test("missing lifetime spend never falls back to 180-day M or old tier",()=>{
 assert.equal(applyRow({tier:"S+",m180:9000,f180:5}).tier,"待核验");
 assert.equal(fromFields({"CRM等级":"B","历史累计消费":[{text:"3,000"}],"近180天有效订单数":1,"历史订单数":8}).tier,"S+");
});
