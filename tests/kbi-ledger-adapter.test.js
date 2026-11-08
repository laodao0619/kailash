"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {prepareGrades}=require("../lib/kbi-ledger-adapter");
const D=Date.parse("2026-11-01T00:00:00Z");
function fixture(){
 return {
  asOf:"2026-11-08T00:00:00.000Z",windowDays:180,
  totals:{orders:5,eligible:5,missingLineParent:0,duplicateOrderIds:0,
   unverifiedLines:0,missingOrderDate:0,futureOrders:0,refundMismatch:0,excluded:{}},
  customers:new Map([["gid://shopify/Customer/101",{
    orders:5,merchandiseCents:320000,windowOrders:5,windowMerchandiseCents:320000,
    firstAt:Date.parse("2026-06-01T00:00:00Z"),lastAt:D
  }]])
 };
}
const reviewed={complete:true,financialReconciled:true};
test("PR4 aggregate maps to the verified Nov 8 S+ rubric only after review",()=>{
 const x=prepareGrades(fixture(),reviewed);
 assert.equal(x.ok,true);
 const customer=x.grades.get("gid://shopify/Customer/101");
 assert.equal(customer.tier,"S+");
 assert.deepEqual([customer.M,customer.F,customer.R],[3200,5,7]);
 assert.equal(customer.lifetimeSpendUSD,3200);
 assert.equal(x.missingNeverPurchased,true);
});
test("unapproved export cannot create a single customer grade",()=>{
 for(const flags of [{},{complete:true},{financialReconciled:true}]){
  const x=prepareGrades(fixture(),flags);
  assert.equal(x.ok,false);
  assert.equal(x.grades.size,0);
 }
});
test("global refund mismatches or missing order dates quarantine the whole snapshot",()=>{
 for(const key of ["refundMismatch","missingOrderDate","duplicateOrderIds","missingLineParent","unverifiedLines","futureOrders"]){
  const f=fixture();f.totals[key]=1;
  const x=prepareGrades(f,reviewed);
  assert.equal(x.ok,false,key);
  assert.equal(x.grades.size,0);
 }
});
test("non 180-day windows and unsupported currencies fail",()=>{
 let f=fixture();f.windowDays=90;
 assert.equal(prepareGrades(f,reviewed).ok,false);
 assert.equal(prepareGrades(fixture(),{...reviewed,currency:"EUR"}).ok,false);
});
test("invalid aggregate returns no partial leaked grades",()=>{
 const f=fixture();
 f.customers.set("gid://shopify/Customer/102",{
  orders:1,windowOrders:1,windowMerchandiseCents:100,merchandiseCents:100,lastAt:null
 });
 const x=prepareGrades(f,reviewed);
 assert.equal(x.ok,false);
 assert.equal(x.grades.size,0);
});
test("zero-order customers are never inferred from the paid-order ledger",()=>{
 const f=fixture();const x=prepareGrades(f,reviewed);
 assert.equal(x.ok,true);
 assert.equal(x.grades.has("gid://shopify/Customer/999"),false);
 assert.equal(x.missingNeverPurchased,true);
});
