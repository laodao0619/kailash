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
async function run(rows,ids=sampleCustomerIds,
 sampleExpectedOrderCounts=Object.fromEntries(ids.map(id=>[id,1])),
 {includeFixtureLines=true}={}){
 const evidence=rows.flatMap(row=>{
  if(row.__parentId||!includeFixtureLines||!row.id)return [row];
  return [row,{__parentId:row.id,id:"gid://shopify/LineItem/"+row.id.split("/").pop(),
   title:"Synthetic test line",quantity:1,
   originalUnitPriceSet:usd(120),discountedTotalSet:usd(120)}];
 });
 return auditJsonl(Readable.from([evidence.map(x=>JSON.stringify(x)).join("\n")+"\n"]),{
  asOf:"2026-11-13T00:00:00Z",sampleCustomerIds:ids,sampleExpectedOrderCounts
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
 assert.equal(x.sampleAudit.customers[0].duplicateOrderIds,1);
 assert.equal(x.sampleAudit.status,"BLOCKED_SAMPLE_ORDER_IDS_DUPLICATED");
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
test("a matching sample with no original Shopify order ID remains blocked",async()=>{
 const rows=[order(1,{id:""}),...Array.from({length:6},(_,i)=>order(i+2))];
 const x=await run(rows);
 assert.equal(x.sampleAudit.matched,7);
 assert.equal(x.sampleAudit.verified,false);
 assert.equal(x.sampleAudit.status,"BLOCKED_SAMPLE_ORDER_IDS_INVALID");
 assert.equal(x.sampleAudit.customers[0].invalidOrderIds,1);
});

test("seven-customer historical source counts must be present and complete",async()=>{
 const rows=Array.from({length:7},(_,i)=>order(i+1));
 const missing=await run(rows,sampleCustomerIds,{});
 assert.equal(missing.sampleAudit.status,"BLOCKED_SAMPLE_SOURCE_COUNTS_MISSING");
 assert.equal(missing.sampleAudit.verified,false);
 assert.equal(missing.sampleAudit.customers[0].expectedOrderCount,null);

 const source=Object.fromEntries(sampleCustomerIds.map(id=>[id,1]));
 source[id(3)]=2; // Customer API says two orders, Bulk only contains one.
 const incomplete=await run(rows,sampleCustomerIds,source);
 assert.equal(incomplete.sampleAudit.status,"BLOCKED_SAMPLE_SOURCE_COUNT_MISMATCH");
 assert.equal(incomplete.sampleAudit.customers[2].expectedOrderCount,2);
 assert.equal(incomplete.sampleAudit.customers[2].totalOrders,1);
 assert.equal(incomplete.sampleAudit.verified,false);
});

test("untrusted sample count configuration is rejected before a financial audit",()=>{
 for(const sampleExpectedOrderCounts of [
  null,[],{[id(1)]:-1},{[id(1)]:1.5},{[id(1)]:"1"},{[id(999)]:1}
 ]){
  assert.throws(()=>createAudit({sampleCustomerIds,
   sampleExpectedOrderCounts}),/Invalid private Shopify sample order-count evidence/);
 }
});


test("seven-customer sample explicitly blocks unreconciled refunds even when source counts match",async()=>{
 const rows=[
  order(1,{displayFinancialStatus:"PARTIALLY_REFUNDED",
   currentSubtotalPriceSet:usd(80),totalRefundedSet:usd(20),
   transactions:[{kind:"SALE",status:"SUCCESS",amountSet:usd(100)}]}),
  ...Array.from({length:6},(_,i)=>order(i+2))
 ];
 const out=await run(rows);
 assert.equal(out.sampleAudit.matched,7);
 assert.equal(out.sampleAudit.customers[0].refundMismatch,1);
 assert.equal(out.sampleAudit.status,"BLOCKED_SAMPLE_REFUND_RECONCILIATION");
 assert.equal(out.sampleAudit.verified,false);
});

test("seven-customer finance sample blocks a refund larger than verified capture",async()=>{
 const rows=[order(1,{displayFinancialStatus:"PARTIALLY_REFUNDED",
  currentSubtotalPriceSet:usd(0),totalRefundedSet:usd(150),transactions:[
   {kind:"SALE",status:"SUCCESS",amountSet:usd(100)},
   {kind:"REFUND",status:"SUCCESS",amountSet:usd(150)}]}),
  ...Array.from({length:6},(_,i)=>order(i+2))];
 const out=await run(rows);
 assert.equal(out.sampleAudit.matched,7);
 assert.equal(out.sampleAudit.status,"BLOCKED_SAMPLE_REFUND_RECONCILIATION");
 assert.equal(out.sampleAudit.customers[0].excluded.refund_exceeds_captured,1);
 assert.equal(out.sampleAudit.verified,false);
});

test("seven-customer sample blocks missing payment evidence before manual financial readiness",async()=>{
 const rows=[order(1,{transactions:[]}),...Array.from({length:6},(_,i)=>order(i+2))];
 const out=await run(rows);
 assert.equal(out.sampleAudit.matched,7);
 assert.equal(out.sampleAudit.customers[0].excluded.missing_settled_payment_evidence,1);
 assert.equal(out.sampleAudit.status,"BLOCKED_SAMPLE_FINANCIAL_EVIDENCE");
 assert.equal(out.sampleAudit.verified,false);
});


test("seven-customer samples block missing line-item amount evidence even with complete Shopify order counts",async()=>{
 const rows=Array.from({length:7},(_,i)=>order(i+1));
 const brokenLine={
  __parentId:"gid://shopify/Order/1",id:"gid://shopify/LineItem/7001",
  title:"Pendant",quantity:2,originalUnitPriceSet:usd(120)
  // discountedTotalSet is missing; neither product value nor USD currency is verifiable.
 };
 const out=await run([...rows,brokenLine]);
 assert.equal(out.sampleAudit.matched,7);
 assert.equal(out.sampleAudit.customers[0].expectedOrderCount,1);
 assert.equal(out.sampleAudit.customers[0].totalOrders,1);
 assert.equal(out.sampleAudit.customers[0].unverifiedLineFinancials,1);
 assert.equal(out.totals.unverifiedLineFinancials,1);
 assert.equal(out.sampleAudit.status,"BLOCKED_SAMPLE_LINE_ITEM_FINANCIAL_EVIDENCE");
 assert.equal(out.sampleAudit.verified,false);

 const completeLine={...brokenLine,discountedTotalSet:usd(120)};
 const good=await run([...rows,completeLine]);
 assert.equal(good.sampleAudit.customers[0].unverifiedLineFinancials,0);
 assert.equal(good.sampleAudit.status,"PENDING_MANUAL_SHOPIFY_FINANCIAL_RECONCILIATION");
});


test("seven-customer sample blocks missing order child lines even when root/source counts match",async()=>{
 const rows=Array.from({length:7},(_,i)=>order(i+1));
 const missing=await run(rows,sampleCustomerIds,
  Object.fromEntries(sampleCustomerIds.map(id=>[id,1])),
  {includeFixtureLines:false});
 assert.equal(missing.sampleAudit.status,"BLOCKED_SAMPLE_MISSING_LINE_ITEMS");
 assert.equal(missing.sampleAudit.verified,false);
 assert.equal(missing.sampleAudit.customers[0].missingLineItems,1);
 assert.equal(missing.totals.missingLineItems,7);
 const withLines=await run(rows);
 assert.equal(withLines.totals.missingLineItems,0);
 assert.equal(withLines.sampleAudit.status,"PENDING_MANUAL_SHOPIFY_FINANCIAL_RECONCILIATION");
});


test("duplicate Shopify line-item IDs block seven-customer finance evidence",async()=>{
 const rows=Array.from({length:7},(_,i)=>order(i+1));
 const duplicate={__parentId:"gid://shopify/Order/1",
  id:"gid://shopify/LineItem/1",title:"Duplicate item",
  quantity:1,originalUnitPriceSet:usd(120),discountedTotalSet:usd(120)};
 const result=await run([...rows,duplicate]);
 assert.equal(result.totals.duplicateLineItemIds,1);
 assert.equal(result.sampleAudit.customers[0].duplicateLineItemIds,1);
 assert.equal(result.sampleAudit.status,"BLOCKED_SAMPLE_LINE_ITEM_IDS_DUPLICATED");
 assert.equal(result.sampleAudit.verified,false);
});

test("malformed line-item GID or blank title cannot count as verified Shopify evidence",async()=>{
 const rows=Array.from({length:7},(_,i)=>order(i+1));
 const invalid={__parentId:"gid://shopify/Order/1",
  id:"line-item-not-a-shopify-gid",title:"",
  quantity:1,originalUnitPriceSet:usd(120),discountedTotalSet:usd(120)};
 const result=await run([...rows,invalid]);
 assert.equal(result.totals.unverifiedLines,1);
 assert.equal(result.sampleAudit.customers[0].invalidLineItems,1);
 assert.equal(result.sampleAudit.status,"BLOCKED_SAMPLE_LINE_ITEM_IDENTITIES_INVALID");
 assert.equal(result.sampleAudit.verified,false);
});
