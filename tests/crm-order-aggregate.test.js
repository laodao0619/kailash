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
 const dormant=customerValues({lifetimeOrders:2,lastOrderAt:"2025-12-01T00:00:00Z"},null,{now:NOW});
 assert.equal(dormant.grade,"沉睡");
 const never=customerValues({lifetimeOrders:0},null,{now:NOW});
 assert.equal(never.grade,"从未购买");
});
