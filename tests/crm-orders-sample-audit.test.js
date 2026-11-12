"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {Readable}=require("node:stream");
const {auditJsonl,createAudit}=require("../lib/crm-orders-ledger");

const id=n=>"gid://shopify/Customer/"+n;
const usd=n=>({shopMoney:{amount:String(n),currencyCode:"USD"}});
function order(n,opts={}){
 return {
  id:"gid://shopify/Order/"+n,
  customer:{id:id(n)},
  createdAt:"2026-10-01T00:00:00Z",
  processedAt:"2026-10-01T00:00:00Z",
  displayFinancialStatus:"PAID",
  currentSubtotalPriceSet:usd(120),
  totalRefundedSet:usd(0),
  transactions:[{kind:"SALE",status:"SUCCESS",amountSet:usd(120)}],
  ...opts
 };
}
const sampleCustomerIds=Array.from({length:7},(_,i)=>id(i+1));
async function run(rows,ids=sampleCustomerIds){
 return auditJsonl(Readable.from([rows.map(x=>JSON.stringify(x)).join("\n")+"\n"]),{
  asOf:"2026-11-13T00:00:00Z",sampleCustomerIds:ids
 });
}
test("exactly seven existing samples yield evidence awaiting manual finance review, not verified grades",async()=>{
 const out=await run(Array.from({length:7},(_,i)=>order(i+1)));
 assert.equal(out.sampleAudit.requested,7);
 assert.equal(out.sampleAudit.matched,7);
 assert.equal(out.sampleAudit.verified,false);
 assert.equal(out.sampleAudit.status,"PENDING_MANUAL_SHOPIFY_FINANCIAL_RECONCILIATION");
 assert.equal(out.sampleAudit.customers[0].lifetimeMerchandiseCents,12000);
 assert.equal(out.sampleAudit.customers[0].windowMerchandiseCents,12000);
 assert.equal(out.sampleAudit.customers[0].orderEvidence[0].eligible,true);
});
test("missing or incomplete high-value customer IDs fail closed without fabrication",async()=>{
 const partial=await run([order(1)]);
 assert.equal(partial.sampleAudit.status,"BLOCKED_SAMPLE_CUSTOMERS_MISSING");
 assert.equal(partial.sampleAudit.matched,1);
 assert.equal(partial.sampleAudit.customers[1].found,false);
 assert.equal(partial.sampleAudit.customers[1].totalOrders,0);
 const missing=await run([order(1)],[]);
 assert.equal(missing.sampleAudit.status,"BLOCKED_REQUIRE_EXACTLY_SEVEN_SAMPLE_CUSTOMERS");
 assert.deepEqual(missing.sampleAudit.customers,[]);
});
test("sample evidence exposes exclusions, historical versus recent spend, and refund discrepancies",async()=>{
 const rows=[
  order(1,{createdAt:"2025-01-01T00:00:00Z",currentSubtotalPriceSet:usd(2000)}),
  order(11,{customer:{id:id(1)},displayFinancialStatus:"PARTIALLY_REFUNDED",
   currentSubtotalPriceSet:usd(80),totalRefundedSet:usd(20),
   transactions:[{kind:"SALE",status:"SUCCESS",amountSet:usd(100)}]}),
  order(12,{customer:{id:id(1)},test:true}),
  ...Array.from({length:6},(_,i)=>order(i+2))
 ];
 const out=await run(rows);
 const x=out.sampleAudit.customers[0];
 assert.equal(x.totalOrders,3);
 assert.equal(x.effectiveOrders,2);
 assert.equal(x.windowOrders,1);
 assert.equal(x.lifetimeMerchandiseCents,208000);
 assert.equal(x.windowMerchandiseCents,8000);
 assert.equal(x.refundMismatch,1);
 assert.equal(x.excluded.test,1);
 assert.equal(x.orderEvidence[1].refundMismatch,true);
 assert.equal(out.sampleAudit.verified,false);
});
test("duplicate Shopify order rows cannot inflate sample lifetime totals",async()=>{
 const x=await run([order(1),order(1),...Array.from({length:6},(_,i)=>order(i+2))]);
 assert.equal(x.sampleAudit.customers[0].totalOrders,1);
 assert.equal(x.sampleAudit.customers[0].lifetimeMerchandiseCents,12000);
 assert.equal(x.totals.duplicateOrderIds,1);
});
test("large customer sample is marked incomplete rather than silently truncated",async()=>{
 const rows=Array.from({length:101},(_,i)=>order(1000+i,{customer:{id:id(1)}}))
  .concat(Array.from({length:6},(_,i)=>order(i+2)));
 const x=await run(rows);
 assert.equal(x.sampleAudit.status,"BLOCKED_SAMPLE_ORDER_EVIDENCE_TRUNCATED");
 assert.equal(x.sampleAudit.customers[0].totalOrders,101);
 assert.equal(x.sampleAudit.customers[0].orderEvidence.length,100);
 assert.equal(x.sampleAudit.customers[0].evidenceTruncated,true);
});
test("sample configuration rejects duplicate, non-GID, oversized and invalid inputs",()=>{
 for(const ids of [[id(1),id(1)],["123"],Array(8).fill(id(1)),null]){
  assert.throws(()=>createAudit({sampleCustomerIds:ids}),/Invalid private Shopify financial audit sample identities/);
 }
});