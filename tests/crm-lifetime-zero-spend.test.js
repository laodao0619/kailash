"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {classify, applyRow} = require("../lib/crm-lifetime-tier");

test("purchased customers with zero lifetime net USD always require reconciliation", () => {
 for (const input of [
  {lifetimeSpend:0,lifetimeOrders:1,f:1,r:20},
  {lifetimeSpend:0,lifetimeOrders:6,f:2,r:60},
  {lifetimeSpend:0,lifetimeOrders:6,f:0,r:240}
 ]) {
  assert.deepEqual(classify(input),{
   grade:"待核验",verified:false,reason:"orders_with_zero_net_spend"
  });
 }
});

test("zero orders with zero net spend remains never purchased; paid tiers unchanged", () => {
 assert.equal(classify({lifetimeSpend:0,lifetimeOrders:0,f:0,r:null}).grade,"从未购买");
 assert.equal(classify({lifetimeSpend:0.01,lifetimeOrders:1,f:1,r:1}).grade,"B");
 assert.equal(classify({lifetimeSpend:800,lifetimeOrders:1,f:1,r:70}).grade,"A");
 assert.equal(classify({lifetimeSpend:1500,lifetimeOrders:1,f:1,r:70}).grade,"S");
 assert.equal(classify({lifetimeSpend:3000,lifetimeOrders:1,f:1,r:70}).grade,"S+");
 assert.equal(classify({lifetimeSpend:3000,lifetimeOrders:1,f:0,r:190}).grade,"沉睡");
});

test("row normalization cannot turn historical zero net spend into a verified tier", () => {
 const row=applyRow({id:"synthetic-customer",spendLifetime:0,ordersLifetime:2,f180:1,rDays:60,m180:0,tier:"B"});
 assert.equal(row.tier,"待核验");
 assert.equal(row.tierVerified,false);
 assert.equal(row.tierBasis,"lifetime_spend_with_180d_purchase");
 assert.equal(row.m180,0);
 assert.equal(row.f180,1);
});
