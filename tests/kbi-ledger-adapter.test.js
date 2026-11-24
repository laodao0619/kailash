"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {prepareGrades}=require("../lib/kbi-ledger-adapter");
const D=Date.parse("2026-11-01T00:00:00Z");
function fixture(){
 return {
  asOf:"2026-11-08T00:00:00.000Z",windowDays:180,
  totals:{orders:5,eligible:5,missingLineParent:0,duplicateOrderIds:0,
   duplicateLineItemIds:0,unverifiedLines:0,unverifiedLineFinancials:0,
   missingLineItems:0,lineSubtotalMismatch:0,duplicateTransactionIdsAcrossOrders:0,
   invalidOrderIds:0,invalidCustomerIds:0,missingOrderDate:0,futureOrders:0,withinWindow:5,
   refundMismatch:0,excluded:{}},
  aggregates:{lifetimeMerchandiseCents:320000,windowMerchandiseCents:320000,
   customersWithWindowOrders:1,customersWithWindowSpendOver3000:1},
  customers:new Map([["gid://shopify/Customer/101",{
    orders:5,merchandiseCents:320000,windowOrders:5,windowMerchandiseCents:320000,
    firstAt:Date.parse("2026-06-01T00:00:00Z"),lastAt:D
  }]])
 };
}
const reviewed={complete:true,financialReconciled:true};
test("PR4 aggregate maps to the verified Nov 12 lifetime S+ rubric only after review",()=>{
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

test("full ledger lifetime spend governs tier even when recent spend and frequency are low",()=>{
 const f=fixture();const c=f.customers.get("gid://shopify/Customer/101");
 c.windowOrders=1;c.windowMerchandiseCents=2000;c.lastAt=Date.parse("2026-06-01T00:00:00Z");
 f.totals.withinWindow=1;
 f.aggregates.windowMerchandiseCents=2000;
 f.aggregates.customersWithWindowSpendOver3000=0;
 const result=prepareGrades(f,reviewed).grades.get("gid://shopify/Customer/101");
 assert.equal(result.tier,"S+");assert.equal(result.M,20);assert.equal(result.F,1);
});

test("consolidated JSONL identity, monetary and association exceptions block every grade",()=>{
 for(const key of [
  "duplicateLineItemIds","unverifiedLineFinancials","missingLineItems",
  "lineSubtotalMismatch","duplicateTransactionIdsAcrossOrders",
  "invalidOrderIds","invalidCustomerIds"
 ]){
  const f=fixture();f.totals[key]=1;
  const result=prepareGrades(f,reviewed);
  assert.equal(result.ok,false,key);
  assert.equal(result.reason,"audit_has_unresolved_exceptions",key);
  assert.equal(result.grades.size,0,key);
 }
});

test("missing consolidated counters fail closed even when manual approval flags are true",()=>{
 for(const key of ["duplicateLineItemIds","lineSubtotalMismatch","invalidOrderIds"]){
  const f=fixture();delete f.totals[key];
  const result=prepareGrades(f,reviewed);
  assert.equal(result.ok,false,key);
  assert.equal(result.reason,"audit_counters_missing",key);
  assert.equal(result.grades.size,0,key);
 }
});

test("unreconciled refunds and payments block all historical CRM grades",()=>{
 for(const reason of [
  "unverified_transaction_identity","missing_settled_payment_evidence",
  "duplicate_transaction_ids","partially_paid_unreconciled",
  "mixed_settlement_kinds_unreconciled","unverified_financial_status",
  "refunded_order_refund_mismatch","refund_exceeds_captured",
  "refunded_merchandise_balance_unreconciled","partial_refund_without_refund_evidence"
 ]){
  const f=fixture();f.totals.excluded[reason]=1;
  const result=prepareGrades(f,reviewed);
  assert.equal(result.ok,false,reason);
  assert.equal(result.reason,"audit_contains_unverified_payments",reason);
  assert.equal(result.grades.size,0,reason);
 }
 const f=fixture();f.totals.excluded.unverified_transactions="1";
 assert.equal(prepareGrades(f,reviewed).reason,"audit_exclusions_invalid");
 const missing=fixture();delete missing.totals.excluded;
 assert.equal(prepareGrades(missing,reviewed).reason,"audit_exclusions_missing");
});

test("full-history grades reject missing or inconsistent global customer aggregates",()=>{
 const missing=fixture();delete missing.aggregates;
 assert.equal(prepareGrades(missing,reviewed).reason,"audit_aggregate_totals_missing");
 const missingWindow=fixture();delete missingWindow.totals.withinWindow;
 assert.equal(prepareGrades(missingWindow,reviewed).reason,"audit_window_count_missing");
 for(const [location,key] of [
  ["totals","eligible"],["totals","withinWindow"],
  ["aggregates","lifetimeMerchandiseCents"],["aggregates","windowMerchandiseCents"],
  ["aggregates","customersWithWindowOrders"],
  ["aggregates","customersWithWindowSpendOver3000"]
 ]){
  const f=fixture();f[location][key]-=1;
  const result=prepareGrades(f,reviewed);
  assert.equal(result.ok,false,location+"."+key);
  assert.equal(result.reason,"audit_customer_aggregate_mismatch",location+"."+key);
  assert.equal(result.grades.size,0);
 }
});
test("missing customer rows, impossible rolling values and unsafe sums never yield verified tiers",()=>{
 const partial=fixture();partial.customers.clear();
 assert.equal(prepareGrades(partial,reviewed).reason,"audit_customer_aggregate_mismatch");
 for(const changes of [
  {windowOrders:6},{windowMerchandiseCents:320001},
  {orders:-1},{merchandiseCents:NaN}
 ]){
  const f=fixture();Object.assign(f.customers.get("gid://shopify/Customer/101"),changes);
  assert.equal(prepareGrades(f,reviewed).reason,"audit_customer_metrics_invalid");
 }
 const tooLarge=fixture();
 tooLarge.customers.set("gid://shopify/Customer/102",{
  orders:1,windowOrders:1,merchandiseCents:Number.MAX_SAFE_INTEGER,
  windowMerchandiseCents:Number.MAX_SAFE_INTEGER,lastAt:D
 });
 assert.equal(prepareGrades(tooLarge,reviewed).reason,"audit_aggregate_overflow");
});

test("rolling M/F cannot be relabelled with a different snapshot day",()=>{
 const f=fixture();
 for(const day of ["2026-11-07","2026-11-09",null,"invalid"]){
  const x=prepareGrades(f,{...reviewed,asOfDate:day});
  assert.equal(x.ok,false);
  assert.equal(x.reason,"audit_snapshot_date_mismatch");
  assert.equal(x.grades.size,0);
 }
 const x=prepareGrades(f,{...reviewed,asOfDate:"2026-11-08"});
 assert.equal(x.ok,true);
 assert.equal(x.grades.get("gid://shopify/Customer/101").evidence.auditDate,"2026-11-08");
 delete f.asOf;
 const missing=prepareGrades(f,{...reviewed,asOfDate:"2026-11-08"});
 assert.equal(missing.ok,false);
 assert.equal(missing.reason,"invalid_snapshot_date");
 assert.equal(missing.grades.size,0);
});
