"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {queryRows,facets}=require("../api/bi-customers-v2");
const {normalize,nextCycle,slotAt}=require("../api/bi-index-build");
const records=[
 {id:"1",gid:"gid://shopify/Customer/1",name:"Alice",email:"a@test.example",country:"美国",tier:"S+",quality:"有效",subscription:"已订阅",m180:3200,f180:6,rDays:3,spendLifetime:6000,ordersLifetime:9,lastOrderAt:999,aov:667},
 {id:"2",gid:"gid://shopify/Customer/2",name:"Bob",email:"b@test.example",country:"德国",tier:"B",quality:"有效",subscription:"未订阅",m180:120,f180:1,rDays:20,spendLifetime:130,ordersLifetime:1,lastOrderAt:888,aov:130},
 {id:"3",gid:"gid://shopify/Customer/3",name:"Carol",email:"c@test.example",country:"美国",tier:"A",quality:"有效",subscription:"已订阅",m180:880,f180:3,rDays:11,spendLifetime:1000,ordersLifetime:4,lastOrderAt:777,aov:250},
 {id:"4",gid:"gid://shopify/Customer/4",name:"Dora",email:"d@test.example",country:"法国",tier:"待核验",quality:"未核验",subscription:"未知",m180:null,f180:null,rDays:null,spendLifetime:null,ordersLifetime:0,lastOrderAt:null,aov:null}
];
test("full-dataset filtering combines level, region, money, orders, recency",()=>{
 const result=queryRows(records,{country:"美国",minM:"800",minF:"3",maxR:"15",sort:"m180",dir:"desc"});
 assert.deepEqual(result.map(x=>x.id),["1","3"]);
 const splus=queryRows(records,{tier:"S+",minLifetime:"5000"});
 assert.deepEqual(splus.map(x=>x.id),["1"]);
});
test("global sorting stable, missing metrics last even ascending",()=>{
 assert.deepEqual(queryRows(records,{sort:"m180",dir:"asc"}).map(x=>x.id),["2","3","1","4"]);
 assert.deepEqual(queryRows(records,{sort:"m180",dir:"desc"}).map(x=>x.id),["1","3","2","4"]);
 assert.deepEqual(queryRows(records,{sort:"ordersLifetime",dir:"desc"}).map(x=>x.id),["1","3","2","4"]);
});
test("search by name, email and identifier",()=>{
 assert.equal(queryRows(records,{q:"ali"}).length,1);
 assert.equal(queryRows(records,{q:"c@test.example"})[0].id,"3");
 assert.equal(queryRows(records,{q:"2"})[0].id,"2");
});
test("facets count full baseline, not first page",()=>{
 const v=facets(records);
 assert.equal(v.tiers.find(x=>x.value==="S+").count,1);
 assert.equal(v.countries.find(x=>x.value==="美国").count,2);
});
test("Feishu snapshot preserves real GID, M/R/F, subscription and unknown metrics",()=>{
 const result=normalize({record_id:"rec1",fields:{
  "Shopify客户ID":"gid://shopify/Customer/1234567890",
  "客户姓名":"Sample","邮箱":"SAMPLE@example.test","CRM等级":"S",
  "近180天净消费":1600.5,"近180天有效订单数":3,"最近购买距今天数R":41,
  "历史累计消费":3900,"历史订单数":8,
  "最近下单日期":1794000000000,"邮件订阅状态":"SUBSCRIBED"
 }});
 assert.equal(result.id,"1234567890");
 assert.equal(result.email,"sample@example.test");
 assert.deepEqual([result.m180,result.f180,result.rDays],[1600.5,3,41]);
 assert.equal(result.aov,487.5);
 const absent=normalize({record_id:"rec2",fields:{"Shopify客户ID":"gid://shopify/Customer/5"}});
 assert.equal(absent.m180,null);assert.equal(absent.f180,null);
 assert.equal(normalize({fields:{"Shopify客户ID":"invalid"}}),null);
});
test("index updates after Beijing source windows and keeps unfinished cursor",()=>{
 const beforeWork=slotAt(new Date("2026-11-08T00:55:00Z"));
 assert.equal(beforeWork,"2026-11-07-afternoon");
 const morning=nextCycle(null,new Date("2026-11-08T01:05:00Z"));
 assert.equal(morning.slot,"2026-11-08-morning");
 morning.page=4;morning.cursor="page_4";
 assert.strictEqual(nextCycle(morning,new Date("2026-11-08T08:00:00Z")),morning);
 morning.complete=true;
 const afternoon=nextCycle(morning,new Date("2026-11-08T08:00:00Z"));
 assert.equal(afternoon.slot,"2026-11-08-afternoon");
 assert.equal(afternoon.page,0);
 assert.equal(slotAt(new Date("2026-11-08T05:25:00Z")),"2026-11-08-morning");
 assert.equal(slotAt(new Date("2026-11-08T05:30:00Z")),"2026-11-08-noon");
 assert.equal(slotAt(new Date("2026-11-08T07:55:00Z")),"2026-11-08-noon");
 assert.equal(slotAt(new Date("2026-11-08T08:00:00Z")),"2026-11-08-afternoon");
});
