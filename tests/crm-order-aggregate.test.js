"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {summarize,customerValues}=require("../lib/crm-order-aggregate");
const NOW=new Date("2026-11-08T00:00:00Z");
test("deduplicates orders and computes USD net totals",()=>{
 const rows=[{id:"1",customerId:"c",usdNetAmount:150,processedAt:"2026-10-01T00:00:00Z"},{id:"1",customerId:"c",usdNetAmount:150,processedAt:"2026-10-01T00:00:00Z"},{id:"2",customerId:"c",usdNetAmount:100,processedAt:"2026-10-10T00:00:00Z"}];
 const m=summarize(rows);assert.deepEqual({m:m.get("c").m,f:m.get("c").f},{m:250,f:2});
});
test("never invents recency for customer with missing last order",()=>{
 const x=customerValues({lifetimeOrders:2,lastOrderAt:null},null,{now:NOW});
 assert.equal(x.grade,"待核验");assert.equal(x.verified,false);
});
test("classifies known older customer as dormant and no-order customer separately",()=>{
 const dormant=customerValues({lifetimeOrders:2,lifetimeSpend:500,lastOrderAt:"2025-12-01T00:00:00Z"},null,{now:NOW});
 assert.equal(dormant.grade,"沉睡");
 const never=customerValues({lifetimeOrders:0,lifetimeSpend:0},null,{now:NOW});
 assert.equal(never.grade,"从未购买");
});

test("high lifetime customer retains S+ after one small recent purchase",()=>{
 const x=customerValues({lifetimeOrders:10,lifetimeSpend:5000},
  {m:100,f:1,last:Date.parse("2026-11-01")},{now:NOW});
 assert.equal(x.grade,"S+");assert.equal(x.m,100);assert.equal(x.f,1);
 assert.equal(x.rfm,"一般发展用户");
});
