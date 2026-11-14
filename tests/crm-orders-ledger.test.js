"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {Readable}=require("node:stream");
const {classifyOrder,auditJsonl}=require("../lib/crm-orders-ledger");
const usd=n=>({shopMoney:{amount:String(n),currencyCode:"USD"}});
function order(overrides={}){
 const result={id:"gid://shopify/Order/1",createdAt:"2026-08-01T12:00:00Z",processedAt:"2026-08-01T12:00:00Z",
  customer:{id:"gid://shopify/Customer/1"},displayFinancialStatus:"PARTIALLY_REFUNDED",
  currentSubtotalPriceSet:usd(80),totalRefundedSet:usd(20),transactions:[
   {kind:"SALE",status:"SUCCESS",amountSet:usd(100)},
   {kind:"REFUND",status:"SUCCESS",amountSet:usd(20)}],...overrides};
 if(Array.isArray(result.transactions))result.transactions=result.transactions.map((tx,i)=>({
  ...tx,id:tx.id===undefined?"gid://shopify/OrderTransaction/"+(i+1):tx.id
 }));
 return result;
}
test("net merchandise isn't reduced a second time by refund",()=>{
 const x=classifyOrder(order());assert.equal(x.eligible,true);
 assert.equal(x.netMerchandiseCents,8000);assert.equal(x.transactionRefundCents,2000);
 assert.equal(x.refundMismatch,false);
});
test("failed refund transactions are excluded from audit",()=>{
 const x=classifyOrder(order({transactions:[
  {kind:"SALE",status:"SUCCESS",amountSet:usd(100)},
  {kind:"REFUND",status:"FAILURE",amountSet:usd(20)}]}));
 assert.equal(x.eligible,true);assert.equal(x.refundMismatch,true);
});
test("exclude cancelled, test, unpaid, fully refunded and invalid currencies",()=>{
 for(const input of [{cancelledAt:"2026-08-02"},{test:true},{displayFinancialStatus:"PENDING"},{displayFinancialStatus:"REFUNDED"},{currentSubtotalPriceSet:usd(0)},{currentSubtotalPriceSet:{shopMoney:{amount:"80",currencyCode:"EUR"}}}])
  assert.equal(classifyOrder(order(input)).eligible,false);
});
test("Bulk JSONL audit tracks parents, child lines and deduplicates order IDs",async()=>{
 const data=[order(),{id:"line-1",title:"Pendant",__parentId:"gid://shopify/Order/1"},order(),
  {id:"line-x",__parentId:"unknown"}].map(x=>JSON.stringify(x)).join("\n")+"\n";
 const chunks=[Buffer.from(data.slice(0,20)),Buffer.from(data.slice(20))];
 const result=await auditJsonl(Readable.from(chunks));
 assert.deepEqual({orders:result.totals.orders,lines:result.totals.lines,eligible:result.totals.eligible,
  duplicates:result.totals.duplicateOrderIds,orphans:result.totals.missingLineParent,customers:result.uniqueCustomers},
  {orders:2,lines:2,eligible:1,duplicates:1,orphans:1,customers:1});
});
test("audit handles UTF-8 split across chunks",async()=>{
 const line=Buffer.from(JSON.stringify(order({name:"藏式项链"}))+"\n");
 const pos=line.indexOf(Buffer.from("藏"));
 const x=await auditJsonl(Readable.from([line.subarray(0,pos+1),line.subarray(pos+1)]));
 assert.equal(x.totals.eligible,1);
});
test("lifetime orders remain separate from rolling 180 days",async()=>{
 const old=order({id:"old",createdAt:"2025-01-02T00:00:00Z",currentSubtotalPriceSet:usd(4000)});
 const recent=order({id:"recent",createdAt:"2026-10-01T00:00:00Z",currentSubtotalPriceSet:usd(1200)});
 const result=await auditJsonl(Readable.from([`${JSON.stringify(old)}\n${JSON.stringify(recent)}\n`]),
  {asOf:"2026-11-08T00:00:00Z"});
 assert.equal(result.totals.eligible,2);
 assert.equal(result.totals.withinWindow,1);
 assert.equal(result.aggregates.lifetimeMerchandiseCents,520000);
 assert.equal(result.aggregates.windowMerchandiseCents,120000);
 assert.equal(result.aggregates.customersWithWindowSpendOver3000,0);
});
test("rolling 180-day threshold is strict and invalid dates are flagged",async()=>{
 const rows=[order({id:"one",createdAt:"2026-11-01T00:00:00Z",currentSubtotalPriceSet:usd(3000)}),
  order({id:"two",createdAt:"2026-11-03T00:00:00Z",customer:{id:"another"},currentSubtotalPriceSet:usd(3000.01)}),
  order({id:"three",createdAt:"invalid"})];
 const result=await auditJsonl(Readable.from([rows.map(JSON.stringify).join("\n")]),
  {asOf:"2026-11-08T00:00:00Z"});
 assert.equal(result.aggregates.customersWithWindowSpendOver3000,1);
 assert.equal(result.totals.missingOrderDate,1);
 assert.equal(result.totals.withinWindow,2);
});

test("orders with invalid or future dates are quarantined from both lifetime and 180-day aggregates",async()=>{
 const rows=[
  order({id:"good",createdAt:"2026-10-01T00:00:00Z",currentSubtotalPriceSet:usd(100)}),
  order({id:"invalid",createdAt:"not-a-date",currentSubtotalPriceSet:usd(7000)}),
  order({id:"future",createdAt:"2027-01-01T00:00:00Z",currentSubtotalPriceSet:usd(9000)})
 ];
 const x=await auditJsonl(Readable.from([rows.map(JSON.stringify).join("\n")+"\n"]),{
  asOf:"2026-11-08T00:00:00Z"
 });
 assert.equal(x.totals.orders,3);
 assert.equal(x.totals.eligible,1);
 assert.equal(x.totals.missingOrderDate,1);
 assert.equal(x.totals.futureOrders,1);
 assert.equal(x.totals.excluded.missing_order_date,1);
 assert.equal(x.totals.excluded.future_order,1);
 assert.equal(x.aggregates.lifetimeMerchandiseCents,10000);
 assert.equal(x.aggregates.windowMerchandiseCents,10000);
 assert.equal(x.uniqueCustomers,1);
});

test("missing, blank or malformed USD evidence is unknown, not a zero-dollar fact",()=>{
 for(const amount of [null,undefined,"", " ", "not-money", "-1", "Infinity", "0x10"]){
  assert.equal(classifyOrder(order({currentSubtotalPriceSet:{shopMoney:{amount,currencyCode:"USD"}}})).eligible,false);
 }
 assert.equal(classifyOrder(order({currentSubtotalPriceSet:usd("0.01")})).eligible,true);
});
test("rejects fractional USD cents and unsafe monetary evidence rather than rounding",()=>{
 const {money}=require("../lib/crm-orders-ledger");
 for(const [amount,expected] of [["0",0],["0.01",1],["1.2",120],["1.20",120],["000.10",10],["12.34",1234]])
  assert.equal(money(usd(amount)),expected,amount);
 for(const amount of ["0.005","0.001","1.999","90071992547410","100000000000000000"])
  assert.equal(money(usd(amount)),null,amount);
 assert.deepEqual(classifyOrder(order({currentSubtotalPriceSet:usd("0.005")})),
  {eligible:false,reason:"unverified_currency"});
 const tx=classifyOrder(order({transactions:[{kind:"REFUND",status:"SUCCESS",amountSet:usd("0.005")}]}));
 assert.equal(tx.eligible,false);
 assert.equal(tx.reason,"unverified_transactions");
});

test("partially paid orders are withheld from lifetime and rolling net spend",async()=>{
 const partial=order({id:"partial",displayFinancialStatus:"PARTIALLY_PAID",currentSubtotalPriceSet:usd(150)});
 assert.deepEqual(classifyOrder(partial),{eligible:false,reason:"partially_paid_unreconciled"});
 const out=await auditJsonl(Readable.from([JSON.stringify(partial)+"\n"]),{asOf:"2026-11-08T00:00:00Z"});
 assert.equal(out.totals.eligible,0);
 assert.equal(out.aggregates.lifetimeMerchandiseCents,0);
 assert.equal(out.totals.excluded.partially_paid_unreconciled,1);
});


test("unsafe cumulative cents block transaction and lifetime audit rather than silently rounding",async()=>{
 const nearLimit="90071992547409.91"; // exactly Number.MAX_SAFE_INTEGER cents
 const txOrder=order({transactions:[
  {kind:"SALE",status:"SUCCESS",amountSet:usd(nearLimit)},
  {kind:"CAPTURE",status:"SUCCESS",amountSet:usd("0.01")}
 ]});
 assert.throws(()=>classifyOrder(txOrder),/Unsafe USD cent aggregate/);
 const first=order({id:"gid://shopify/Order/91",currentSubtotalPriceSet:usd(nearLimit)});
 const second=order({id:"gid://shopify/Order/92",currentSubtotalPriceSet:usd("0.01")});
 await assert.rejects(()=>auditJsonl(Readable.from([
  JSON.stringify(first)+"\n"+JSON.stringify(second)+"\n"
 ]),{asOf:"2026-11-13T00:00:00Z"}),/Unsafe USD cent aggregate/);
});

test("paid order without settled capture is excluded from financial aggregates",async()=>{
 const inputs=[
  order({id:"gid://shopify/Order/101",transactions:[]}),
  order({id:"gid://shopify/Order/102",transactions:undefined}),
  order({id:"gid://shopify/Order/103",transactions:[
   {kind:"AUTHORIZATION",status:"SUCCESS",amountSet:usd(100)}]}),
  order({id:"gid://shopify/Order/104",transactions:[
   {kind:"SALE",status:"FAILURE",amountSet:usd(100)}]})
 ];
 for(const row of inputs){
  assert.deepEqual(classifyOrder(row),{
   eligible:false,reason:"missing_settled_payment_evidence"
  });
 }
 const out=await auditJsonl(Readable.from([inputs.map(JSON.stringify).join("\n")+"\n"]),{
  asOf:"2026-11-13T00:00:00Z"
 });
 assert.equal(out.totals.eligible,0);
 assert.equal(out.totals.excluded.missing_settled_payment_evidence,4);
 assert.equal(out.aggregates.lifetimeMerchandiseCents,0);
 assert.equal(out.aggregates.windowMerchandiseCents,0);
 assert.equal(out.uniqueCustomers,0);
});

test("fully refunded orders reconcile successful refund evidence even when excluded from F",async()=>{
 const full=order({
  id:"gid://shopify/Order/201",
  displayFinancialStatus:"REFUNDED",currentSubtotalPriceSet:usd(0),
  totalRefundedSet:usd(100),transactions:[
   {kind:"SALE",status:"SUCCESS",amountSet:usd(100)},
   {kind:"REFUND",status:"SUCCESS",amountSet:usd(100)}
  ]
 });
 assert.deepEqual(classifyOrder(full),{eligible:false,reason:"fully_refunded_or_zero"});
 const missingRefund=order({...full,id:"gid://shopify/Order/202",
  transactions:[{kind:"SALE",status:"SUCCESS",amountSet:usd(100)},
   {kind:"REFUND",status:"FAILURE",amountSet:usd(100)}]});
 assert.deepEqual(classifyOrder(missingRefund),{eligible:false,reason:"refunded_order_refund_mismatch"});
 const unknownRefund=order({...full,id:"gid://shopify/Order/203",
  transactions:[{kind:"REFUND",status:"SUCCESS",amountSet:usd("0.005")}]});
 assert.deepEqual(classifyOrder(unknownRefund),{eligible:false,reason:"unverified_transactions"});
 const noCapture=order({...full,id:"gid://shopify/Order/204",transactions:[
  {kind:"REFUND",status:"SUCCESS",amountSet:usd(100)}]});
 assert.deepEqual(classifyOrder(noCapture),{eligible:false,reason:"missing_settled_payment_evidence"});
 const failedCapture=order({...full,id:"gid://shopify/Order/205",transactions:[
  {kind:"SALE",status:"FAILURE",amountSet:usd(100)},
  {kind:"REFUND",status:"SUCCESS",amountSet:usd(100)}]});
 assert.deepEqual(classifyOrder(failedCapture),{eligible:false,reason:"missing_settled_payment_evidence"});
 const result=await auditJsonl(Readable.from([JSON.stringify(full)+"\n"+JSON.stringify(missingRefund)+"\n"]),{
  asOf:"2026-11-13T00:00:00Z"
 });
 assert.equal(result.totals.eligible,0);
 assert.equal(result.totals.excluded.fully_refunded_or_zero,1);
 assert.equal(result.totals.excluded.refunded_order_refund_mismatch,1);
 assert.equal(result.aggregates.lifetimeMerchandiseCents,0);
 const {verifyArchiveIntegrity}=require("../lib/crm-orders-ledger");
 const archive={status:"COMPLETED",downloaded:true,archivedAt:"2026-11-13T00:00:00Z",
  rootObjectCount:"2",objectCount:"2"};
 assert.equal(verifyArchiveIntegrity(result,archive).status,"BLOCKED_REFUND_RECONCILIATION");
});

test("refunds exceeding proven settled captures block both paid and fully refunded orders",async()=>{
 const partial=order({id:"gid://shopify/Order/301",displayFinancialStatus:"PARTIALLY_REFUNDED",
  currentSubtotalPriceSet:usd(40),totalRefundedSet:usd(120),transactions:[
   {kind:"SALE",status:"SUCCESS",amountSet:usd(100)},
   {kind:"REFUND",status:"SUCCESS",amountSet:usd(120)}]});
 const full=order({...partial,id:"gid://shopify/Order/302",
  displayFinancialStatus:"REFUNDED",currentSubtotalPriceSet:usd(0)});
 for(const row of [partial,full])assert.deepEqual(classifyOrder(row),{
  eligible:false,reason:"refund_exceeds_captured"});
 const result=await auditJsonl(Readable.from([
  JSON.stringify(partial)+"\n"+JSON.stringify(full)+"\n"
 ]),{asOf:"2026-11-13T00:00:00Z"});
 assert.equal(result.totals.eligible,0);
 assert.equal(result.totals.excluded.refund_exceeds_captured,2);
 const {verifyArchiveIntegrity}=require("../lib/crm-orders-ledger");
 assert.equal(verifyArchiveIntegrity(result,{status:"COMPLETED",downloaded:true,
  archivedAt:"2026-11-13T00:00:00Z",rootObjectCount:"2",objectCount:"2"}).status,
  "BLOCKED_REFUND_RECONCILIATION");
});

test("successful CAPTURE without SALE still proves settled funds",()=>{
 const x=classifyOrder(order({transactions:[
  {kind:"AUTHORIZATION",status:"SUCCESS",amountSet:usd(100)},
  {kind:"CAPTURE",status:"SUCCESS",amountSet:usd(100)},
  {kind:"REFUND",status:"SUCCESS",amountSet:usd(20)}
 ]}));
 assert.equal(x.eligible,true);
 assert.equal(x.capturedCents,10000);
 assert.equal(x.refundMismatch,false);
});

test("private Shopify completed archive counts gate audit readiness",()=>{
 const {verifyArchiveIntegrity}=require("../lib/crm-orders-ledger");
 const audit={parsedLines:3,totals:{orders:2,lines:1,missingLineParent:0,duplicateOrderIds:0,unverifiedLines:0}};
 const archived={status:"COMPLETED",downloaded:true,archivedAt:"2026-11-13T00:00:00Z",
  rootObjectCount:"2",objectCount:"3"};
 let result=verifyArchiveIntegrity(audit,archived);
 assert.equal(result.status,"PENDING_MANUAL_EXPORT_AND_FINANCIAL_RECONCILIATION");
 assert.equal(result.verified,false);
 assert.equal(result.expectedOrders,2);
 assert.equal(verifyArchiveIntegrity(audit,null).status,"BLOCKED_EXPORT_NOT_ARCHIVED");
 assert.equal(verifyArchiveIntegrity(audit,{...archived,downloaded:false}).status,"BLOCKED_EXPORT_NOT_ARCHIVED");
 for(const change of [{rootObjectCount:"3"},{objectCount:"4"}]){
  assert.equal(verifyArchiveIntegrity(audit,{...archived,...change}).status,"BLOCKED_EXPORT_COUNTS_MISMATCH");
 }
 for(const count of ["NaN",null,"9007199254740993"]){
  assert.equal(verifyArchiveIntegrity(audit,{...archived,rootObjectCount:count}).status,
   "BLOCKED_EXPORT_COUNTS_MISSING_OR_INVALID");
 }
 for(const key of ["missingLineParent","duplicateOrderIds","unverifiedLines"]){
  assert.equal(verifyArchiveIntegrity({...audit,totals:{...audit.totals,[key]:1}},archived).status,
   "BLOCKED_JSONL_ASSOCIATION_INTEGRITY");
 }
});

test("archive counts cannot excuse malformed Shopify root IDs or malformed supplied customer IDs",async()=>{
 const {verifyArchiveIntegrity}=require("../lib/crm-orders-ledger");
 const rows=[
  order({id:"not-an-order-gid"}),
  order({id:"gid://shopify/Order/2",customer:{id:"2"}})
 ];
 const out=await auditJsonl(Readable.from([rows.map(JSON.stringify).join("\n")+"\n"]),{
  asOf:"2026-11-13T00:00:00Z"
 });
 assert.equal(out.totals.orders,2);
 assert.equal(out.totals.invalidOrderIds,1);
 assert.equal(out.totals.invalidCustomerIds,1);
 const archived={status:"COMPLETED",downloaded:true,archivedAt:"2026-11-13T00:00:00Z",
  rootObjectCount:"2",objectCount:"2"};
 assert.equal(verifyArchiveIntegrity(out,archived).status,"BLOCKED_JSONL_ASSOCIATION_INTEGRITY");
 const good=await auditJsonl(Readable.from([JSON.stringify(order())+"\n"]),{
  asOf:"2026-11-13T00:00:00Z"
 });
 assert.equal(good.totals.invalidOrderIds,0);
 assert.equal(good.totals.invalidCustomerIds,0);
 assert.equal(verifyArchiveIntegrity(good,{...archived,rootObjectCount:"1",objectCount:"1"}).status,
  "BLOCKED_ORDER_LINE_ITEMS_MISSING");
 const validLine={__parentId:"gid://shopify/Order/1",id:"gid://shopify/LineItem/1",
  title:"Test item",quantity:1,originalUnitPriceSet:usd(100),discountedTotalSet:usd(80)};
 const complete=await auditJsonl(Readable.from([
  JSON.stringify(order())+"\n"+JSON.stringify(validLine)+"\n"
 ]),{asOf:"2026-11-13T00:00:00Z"});
 assert.equal(complete.totals.missingLineItems,0);
 assert.equal(verifyArchiveIntegrity(complete,{...archived,rootObjectCount:"1",objectCount:"2"}).status,
  "PENDING_MANUAL_EXPORT_AND_FINANCIAL_RECONCILIATION");
});

test("count-consistent archive is blocked when finance evidence cannot be reconciled",()=>{
 const {verifyArchiveIntegrity}=require("../lib/crm-orders-ledger");
 const archived={status:"COMPLETED",downloaded:true,archivedAt:"2026-11-13T00:00:00Z",
  rootObjectCount:"1",objectCount:"1"};
 const base={parsedLines:1,totals:{orders:1,missingLineParent:0,duplicateOrderIds:0,
  unverifiedLines:0,missingOrderDate:0,futureOrders:0,refundMismatch:0,excluded:{}}};
 for(const [changes,status] of [
  [{missingOrderDate:1},"BLOCKED_ORDER_DATE_EVIDENCE"],
  [{futureOrders:1},"BLOCKED_ORDER_DATE_EVIDENCE"],
  [{refundMismatch:1},"BLOCKED_REFUND_RECONCILIATION"],
  [{excluded:{partially_paid_unreconciled:1}},"BLOCKED_PARTIAL_PAYMENT_RECONCILIATION"],
  [{excluded:{unverified_currency:1}},"BLOCKED_PAYMENT_OR_CURRENCY_EVIDENCE"],
  [{excluded:{unverified_transactions:1}},"BLOCKED_PAYMENT_OR_CURRENCY_EVIDENCE"],
  [{excluded:{missing_settled_payment_evidence:1}},"BLOCKED_PAYMENT_OR_CURRENCY_EVIDENCE"]
 ]){
  const audit={...base,totals:{...base.totals,...changes}};
  assert.equal(verifyArchiveIntegrity(audit,archived).status,status);
  assert.equal(verifyArchiveIntegrity(audit,archived).verified,false);
 }
 assert.equal(verifyArchiveIntegrity(base,archived).status,
  "PENDING_MANUAL_EXPORT_AND_FINANCIAL_RECONCILIATION");
});


test("line item financial evidence blocks count-consistent archives without verified quantity/prices",async()=>{
 const {verifyArchiveIntegrity}=require("../lib/crm-orders-ledger");
 const base=order();
 const line={__parentId:base.id,id:"gid://shopify/LineItem/1",title:"Pendant",quantity:1,
  originalUnitPriceSet:usd(100),discountedTotalSet:usd(80)};
 const archived={status:"COMPLETED",downloaded:true,archivedAt:"2026-11-13T00:00:00Z",
  rootObjectCount:"1",objectCount:"2"};
 async function check(item){
  const out=await auditJsonl(Readable.from([JSON.stringify(base)+"\n"+JSON.stringify(item)+"\n"]),{
   asOf:"2026-11-13T00:00:00Z"
  });
  assert.equal(out.totals.orders,1);
  assert.equal(out.totals.lines,1);
  assert.equal(out.totals.missingLineParent,0);
  return {out,status:verifyArchiveIntegrity(out,archived).status};
 }
 const good=await check(line);
 assert.equal(good.out.totals.unverifiedLineFinancials,0);
 assert.equal(good.status,"PENDING_MANUAL_EXPORT_AND_FINANCIAL_RECONCILIATION");
 for(const invalid of [
  {...line,quantity:undefined},
  {...line,quantity:-1},
  {...line,quantity:1.5},
  {...line,originalUnitPriceSet:null},
  {...line,discountedTotalSet:undefined},
  {...line,discountedTotalSet:{shopMoney:{amount:"80",currencyCode:"EUR"}}},
  {...line,discountedTotalSet:usd("0.005")}
 ]){
  const result=await check(invalid);
  assert.equal(result.out.totals.unverifiedLineFinancials,1);
  assert.equal(result.status,"BLOCKED_LINE_ITEM_FINANCIAL_EVIDENCE");
 }
 // Returned/removed line items can legitimately have zero quantity/price.
 const zero=await check({...line,quantity:0,discountedTotalSet:usd(0)});
 assert.equal(zero.out.totals.unverifiedLineFinancials,0);
 assert.equal(zero.status,"PENDING_MANUAL_EXPORT_AND_FINANCIAL_RECONCILIATION");
});

test("duplicate Shopify transaction IDs cannot inflate captured funds or pass archive finance checks",async()=>{
 const duplicate=order({
  id:"gid://shopify/Order/901",
  displayFinancialStatus:"PARTIALLY_REFUNDED",
  currentSubtotalPriceSet:usd(0),totalRefundedSet:usd(150),
  transactions:[
   {id:"gid://shopify/OrderTransaction/1",kind:"SALE",status:"SUCCESS",amountSet:usd(100)},
   {id:"gid://shopify/OrderTransaction/1",kind:"SALE",status:"SUCCESS",amountSet:usd(100)},
   {id:"gid://shopify/OrderTransaction/2",kind:"REFUND",status:"SUCCESS",amountSet:usd(150)}
  ]
 });
 assert.deepEqual(classifyOrder(duplicate),{eligible:false,reason:"duplicate_transaction_ids"});
 const line={__parentId:duplicate.id,id:"gid://shopify/LineItem/901",title:"Pendant",
  quantity:0,originalUnitPriceSet:usd(100),discountedTotalSet:usd(0)};
 const result=await auditJsonl(Readable.from([
  JSON.stringify(duplicate)+"\n"+JSON.stringify(line)+"\n"
 ]),{asOf:"2026-11-13T00:00:00Z"});
 assert.equal(result.totals.eligible,0);
 assert.equal(result.totals.excluded.duplicate_transaction_ids,1);
 const {verifyArchiveIntegrity}=require("../lib/crm-orders-ledger");
 assert.equal(verifyArchiveIntegrity(result,{status:"COMPLETED",downloaded:true,
  archivedAt:"2026-11-13T00:00:00Z",rootObjectCount:"1",objectCount:"2"}).status,
  "BLOCKED_PAYMENT_OR_CURRENCY_EVIDENCE");
});

test("unidentified successful payment blocks all-history evidence",async()=>{
 const {verifyArchiveIntegrity}=require("../lib/crm-orders-ledger");
 const o=order({id:"gid://shopify/Order/999",transactions:[
  {id:null,kind:"SALE",status:"SUCCESS",amountSet:usd(100)},
  {id:"gid://shopify/OrderTransaction/1002",kind:"REFUND",status:"SUCCESS",amountSet:usd(20)}
 ]});
 assert.equal(classifyOrder(o).reason,"unverified_transaction_identity");
 const out=await auditJsonl(Readable.from([JSON.stringify(o)+"\n"]),{asOf:"2026-11-13T00:00:00Z"});
 assert.equal(out.totals.excluded.unverified_transaction_identity,1);
 assert.equal(verifyArchiveIntegrity(out,{status:"COMPLETED",downloaded:true,
  archivedAt:"2026-11-13T00:00:00Z",rootObjectCount:"1",objectCount:"1"}).status,
  "BLOCKED_PAYMENT_OR_CURRENCY_EVIDENCE");
 const bad=order({transactions:[{id:"plain-string",kind:"SALE",status:"SUCCESS",amountSet:usd(100)}]});
 assert.equal(classifyOrder(bad).reason,"unverified_transaction_identity");
});
test("failed or authorization transactions need not have settlement IDs",()=>{
 const o=order({displayFinancialStatus:"PAID",totalRefundedSet:usd(0),transactions:[
  {id:"gid://shopify/OrderTransaction/2001",kind:"SALE",status:"SUCCESS",amountSet:usd(100)},
  {id:null,kind:"AUTHORIZATION",status:"SUCCESS",amountSet:usd(100)},
  {id:null,kind:"REFUND",status:"FAILURE",amountSet:usd(20)}
 ]});
 assert.equal(classifyOrder(o).eligible,true);
});
