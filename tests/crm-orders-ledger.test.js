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
 // Synthetic high-value orders need matching settlement evidence.
 if(overrides.currentSubtotalPriceSet && !Object.prototype.hasOwnProperty.call(overrides,"transactions") &&
    Number(result.currentSubtotalPriceSet?.shopMoney?.amount)>100){
  result.transactions[0]={...result.transactions[0],amountSet:usd(result.currentSubtotalPriceSet.shopMoney.amount)};
 }
 if(Array.isArray(result.transactions))result.transactions=result.transactions.map((tx,i)=>({
  ...tx,id:tx.id===undefined?"gid://shopify/OrderTransaction/"+(i+1):tx.id
 }));
 return result;
}
test("a PAID order with a token capture cannot substantiate its full merchandise spend",async()=>{
 const underfunded=order({id:"gid://shopify/Order/4001",displayFinancialStatus:"PAID",
  currentSubtotalPriceSet:usd(150),totalRefundedSet:usd(0),transactions:[
   {kind:"SALE",status:"SUCCESS",amountSet:usd("0.01")}]});
 assert.deepEqual(classifyOrder(underfunded),{eligible:false,reason:"settlement_below_merchandise"});
 const out=await auditJsonl(Readable.from([JSON.stringify(underfunded)+"\n"]),{
  asOf:"2026-11-13T00:00:00Z"});
 assert.equal(out.totals.excluded.settlement_below_merchandise,1);
 assert.equal(out.aggregates.lifetimeMerchandiseCents,0);
 assert.equal(out.totals.eligible,0);
 const {verifyArchiveIntegrity}=require("../lib/crm-orders-ledger");
 assert.equal(verifyArchiveIntegrity(out,{status:"COMPLETED",downloaded:true,
  archivedAt:"2026-11-13T00:00:00Z",rootObjectCount:"1",objectCount:"1"}).status,
  "BLOCKED_PAYMENT_OR_CURRENCY_EVIDENCE");
});


test("cancelled orders with captured funds are quarantined before lifetime audit approval",async()=>{
 const {verifyArchiveIntegrity}=require("../lib/crm-orders-ledger");
 const cancelled=order({id:"gid://shopify/Order/4901",
  cancelledAt:"2026-08-02T00:00:00Z",displayFinancialStatus:"PAID",
  totalRefundedSet:usd(0),transactions:[{
   kind:"SALE",status:"SUCCESS",amountSet:usd(80)}]});
 assert.deepEqual(classifyOrder(cancelled),{
  eligible:false,reason:"cancelled_settlement_unreconciled"});
 const pendingWithCapture=order({id:"gid://shopify/Order/4902",
  cancelledAt:"2026-08-02T00:00:00Z",displayFinancialStatus:"PENDING",
  transactions:[{kind:"CAPTURE",status:"SUCCESS",amountSet:usd(80)}]});
 assert.equal(classifyOrder(pendingWithCapture).reason,"cancelled_settlement_unreconciled");
 const cancelledWithoutFunds=order({id:"gid://shopify/Order/4903",
  cancelledAt:"2026-08-02T00:00:00Z",displayFinancialStatus:"PENDING",
  transactions:[]});
 assert.equal(classifyOrder(cancelledWithoutFunds).reason,"cancelled");
 const out=await auditJsonl(Readable.from([JSON.stringify(cancelled)+"\n"]),{
  asOf:"2026-11-13T00:00:00Z"});
 assert.equal(out.totals.eligible,0);
 assert.equal(out.totals.excluded.cancelled_settlement_unreconciled,1);
 assert.equal(out.aggregates.lifetimeMerchandiseCents,0);
 assert.equal(verifyArchiveIntegrity(out,{
  status:"COMPLETED",downloaded:true,archivedAt:"2026-11-13T00:00:00Z",
  rootObjectCount:"1",objectCount:"1"
 }).status,"BLOCKED_CANCELLED_SETTLEMENT_RECONCILIATION");
});

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
  transactions:[{id:"gid://shopify/OrderTransaction/2021",kind:"SALE",status:"SUCCESS",amountSet:usd(100)},
   {id:"gid://shopify/OrderTransaction/2022",kind:"REFUND",status:"FAILURE",amountSet:usd(100)}]});
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

test("REFUNDED status with positive merchandise balance blocks finance and sample signoff",async()=>{
 const {verifyArchiveIntegrity}=require("../lib/crm-orders-ledger");
 const sampleIds=Array.from({length:7},(_,i)=>"gid://shopify/Customer/"+(9600+i));
 const rows=[];
 for(let i=0;i<7;i++){
  const id="gid://shopify/Order/"+(9600+i);
  const refunded=i===0;
  const purchase=order({
   id,customer:{id:sampleIds[i]},
   displayFinancialStatus:refunded?"REFUNDED":"PAID",
   currentSubtotalPriceSet:usd(100),
   totalRefundedSet:usd(refunded?100:0),
   transactions:refunded?[
    {id:"gid://shopify/OrderTransaction/19600",kind:"SALE",status:"SUCCESS",amountSet:usd(100)},
    {id:"gid://shopify/OrderTransaction/19601",kind:"REFUND",status:"SUCCESS",amountSet:usd(100)}
   ]:[
    {id:"gid://shopify/OrderTransaction/"+(19610+i),kind:"SALE",status:"SUCCESS",amountSet:usd(100)}
   ]
  });
  rows.push(purchase,{__parentId:id,id:"gid://shopify/LineItem/"+(9600+i),
   title:"Sample item",quantity:1,originalUnitPriceSet:usd(100),discountedTotalSet:usd(100)});
 }
 assert.deepEqual(classifyOrder(rows[0]),{
  eligible:false,reason:"refunded_merchandise_balance_unreconciled"
 });
 const out=await auditJsonl(Readable.from([rows.map(JSON.stringify).join("\n")+"\n"]),{
  asOf:"2026-11-20T00:00:00Z",
  sampleCustomerIds:sampleIds,
  sampleExpectedOrderCounts:Object.fromEntries(sampleIds.map(id=>[id,1]))
 });
 assert.equal(out.totals.excluded.refunded_merchandise_balance_unreconciled,1);
 assert.equal(out.totals.eligible,6);
 assert.equal(out.aggregates.lifetimeMerchandiseCents,60000);
 assert.equal(out.sampleAudit.status,"BLOCKED_SAMPLE_REFUND_RECONCILIATION");
 const archive={status:"COMPLETED",downloaded:true,archivedAt:"2026-11-20T00:00:00Z",
  rootObjectCount:"7",objectCount:"14"};
 assert.equal(verifyArchiveIntegrity(out,archive).status,"BLOCKED_REFUND_RECONCILIATION");
 assert.equal(out.sampleAudit.verified,false);
});

test("refunds exceeding proven settled captures block both paid and fully refunded orders",async()=>{
 const partial=order({id:"gid://shopify/Order/301",displayFinancialStatus:"PARTIALLY_REFUNDED",
  currentSubtotalPriceSet:usd(40),totalRefundedSet:usd(120),transactions:[
   {kind:"SALE",status:"SUCCESS",amountSet:usd(100)},
   {kind:"REFUND",status:"SUCCESS",amountSet:usd(120)}]});
 const full=order({...partial,id:"gid://shopify/Order/302",
  displayFinancialStatus:"REFUNDED",currentSubtotalPriceSet:usd(0),
  transactions:partial.transactions.map((tx,i)=>({...tx,id:"gid://shopify/OrderTransaction/"+(3021+i)}))});
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
  {...line,quantity:0,discountedTotalSet:usd(1)},
  {...line,originalUnitPriceSet:usd(79),discountedTotalSet:usd(80)},
  {...line,quantity:2,originalUnitPriceSet:usd(39),discountedTotalSet:usd(80)},
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

test("seven-customer finance sample blocks impossible discounted merchandise totals",async()=>{
 const {verifyArchiveIntegrity}=require("../lib/crm-orders-ledger");
 const ids=Array.from({length:7},(_,i)=>"gid://shopify/Customer/"+(9901+i));
 const rows=[];
 for(let i=0;i<7;i++){
  const id="gid://shopify/Order/"+(9901+i);
  rows.push(order({id,customer:{id:ids[i]},displayFinancialStatus:"PAID",
   totalRefundedSet:usd(0),transactions:[
   {id:"gid://shopify/OrderTransaction/"+(19901+i),
    kind:"SALE",status:"SUCCESS",amountSet:usd(100)}]}));
  rows.push({__parentId:id,id:"gid://shopify/LineItem/"+(9901+i),title:"Pendant",
   quantity:1,originalUnitPriceSet:usd(i===0?70:100),discountedTotalSet:usd(80)});
 }
 const out=await auditJsonl(Readable.from([rows.map(JSON.stringify).join("\n")+"\n"]),{
  asOf:"2026-11-20T00:00:00Z",
  sampleCustomerIds:ids,sampleExpectedOrderCounts:Object.fromEntries(ids.map(id=>[id,1]))
 });
 assert.equal(out.totals.unverifiedLineFinancials,1);
 assert.equal(out.sampleAudit.status,"BLOCKED_SAMPLE_LINE_ITEM_FINANCIAL_EVIDENCE");
 assert.equal(out.sampleAudit.verified,false);
 assert.equal(verifyArchiveIntegrity(out,{status:"COMPLETED",downloaded:true,
  archivedAt:"2026-11-20T00:00:00Z",rootObjectCount:"7",objectCount:"14"}).status,
  "BLOCKED_LINE_ITEM_FINANCIAL_EVIDENCE");
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

test("a settled transaction reused across orders blocks both archive and seven-customer finance sample",async()=>{
 const {verifyArchiveIntegrity}=require("../lib/crm-orders-ledger");
 const customerIds=Array.from({length:7},(_,i)=>"gid://shopify/Customer/"+(7801+i));
 const rows=[];
 for(let i=0;i<7;i++){
  const id="gid://shopify/Order/"+(7801+i);
  rows.push(order({id,customer:{id:customerIds[i]},displayFinancialStatus:"PAID",
   currentSubtotalPriceSet:usd(100),totalRefundedSet:usd(0),transactions:[
    {id:"gid://shopify/OrderTransaction/"+(i<2?9001:9001+i),
     kind:"SALE",status:"SUCCESS",amountSet:usd(100)}]}));
  rows.push({__parentId:id,id:"gid://shopify/LineItem/"+(7801+i),
   title:"Pendant",quantity:1,originalUnitPriceSet:usd(100),discountedTotalSet:usd(100)});
 }
 const archived={status:"COMPLETED",downloaded:true,archivedAt:"2026-11-13T00:00:00Z",
  rootObjectCount:"7",objectCount:"14"};
 const out=await auditJsonl(Readable.from([rows.map(JSON.stringify).join("\n")+"\n"]),{
  asOf:"2026-11-13T00:00:00Z",sampleCustomerIds:customerIds,
  sampleExpectedOrderCounts:Object.fromEntries(customerIds.map(id=>[id,1]))
 });
 assert.equal(out.totals.duplicateTransactionIdsAcrossOrders,1);
 assert.equal(out.sampleAudit.status,"BLOCKED_SAMPLE_TRANSACTION_IDS_REUSED_ACROSS_ORDERS");
 assert.equal(verifyArchiveIntegrity(out,archived).status,"BLOCKED_TRANSACTION_ASSOCIATION_INTEGRITY");
 assert.equal(out.sampleAudit.verified,false);
 // Identity uniqueness is independent of settled totals; no inferred financial signoff.
 assert.equal(out.totals.eligible,7);
});

test("different settled transaction IDs across orders do not trigger false association failures",async()=>{
 const {verifyArchiveIntegrity}=require("../lib/crm-orders-ledger");
 const orders=[1,2].map(i=>order({id:"gid://shopify/Order/"+(8100+i),
  transactions:[{id:"gid://shopify/OrderTransaction/"+(8200+i),
   kind:"SALE",status:"SUCCESS",amountSet:usd(100)}],
  currentSubtotalPriceSet:usd(100),totalRefundedSet:usd(0),displayFinancialStatus:"PAID"}));
 const rows=orders.flatMap((o,i)=>[o,{__parentId:o.id,id:"gid://shopify/LineItem/"+(8100+i),
  title:"Pendant",quantity:1,originalUnitPriceSet:usd(100),discountedTotalSet:usd(100)}]);
 const out=await auditJsonl(Readable.from([rows.map(JSON.stringify).join("\n")+"\n"]),{
  asOf:"2026-11-13T00:00:00Z"
 });
 assert.equal(out.totals.duplicateTransactionIdsAcrossOrders,0);
 assert.equal(verifyArchiveIntegrity(out,{status:"COMPLETED",downloaded:true,
  archivedAt:"2026-11-13T00:00:00Z",rootObjectCount:"2",objectCount:"4"}).status,
  "PENDING_MANUAL_EXPORT_AND_FINANCIAL_RECONCILIATION");
});

test("invalid Shopify calendar dates are blocked before financial or 180-day aggregation",async()=>{
 const {createAudit,verifyArchiveIntegrity}=require("../lib/crm-orders-ledger");
 const invalidDates=["2026-02-30T00:00:00Z","2026-04-31T10:20:00+08:00"];
 const rows=invalidDates.flatMap((createdAt,i)=>{
  const purchase=order({
   id:"gid://shopify/Order/"+(9901+i),createdAt,
   customer:{id:"gid://shopify/Customer/"+(9901+i)},
   transactions:[{id:"gid://shopify/OrderTransaction/"+(9901+i),
    kind:"SALE",status:"SUCCESS",amountSet:usd(100)}],
   displayFinancialStatus:"PAID",currentSubtotalPriceSet:usd(100),totalRefundedSet:usd(0)
  });
  return [purchase,{__parentId:purchase.id,id:"gid://shopify/LineItem/"+(9901+i),
   title:"Synthetic item",quantity:1,
   originalUnitPriceSet:usd(100),discountedTotalSet:usd(100)}];
 });
 const output=await auditJsonl(Readable.from([rows.map(JSON.stringify).join("\n")+"\n"]),{
  asOf:"2026-11-16T00:00:00Z"
 });
 assert.equal(output.totals.orders,2);
 assert.equal(output.totals.eligible,0);
 assert.equal(output.totals.missingOrderDate,2);
 assert.equal(output.totals.excluded.missing_order_date,2);
 assert.equal(output.uniqueCustomers,0);
 assert.equal(verifyArchiveIntegrity(output,{status:"COMPLETED",downloaded:true,
  archivedAt:"2026-11-16T00:00:00Z",rootObjectCount:"2",objectCount:"4"}).status,
  "BLOCKED_ORDER_DATE_EVIDENCE");
 for(const invalid of invalidDates){
  assert.throws(()=>createAudit({asOf:invalid}),/Invalid audit window/);
 }
 // Validate the calendar in the timestamp's original offset, not UTC date.
 const valid=order({createdAt:"2024-02-29T23:30:00-05:00"});
 const leap=await auditJsonl(Readable.from([JSON.stringify(valid)+"\n"]),{
  asOf:"2024-03-01T05:00:00Z"
 });
 assert.equal(leap.totals.eligible,1);
 assert.equal(leap.totals.withinWindow,1);
});


test("mixed SALE and CAPTURE require explicit settlement reconciliation",async()=>{
 const mixed=order({
  id:"gid://shopify/Order/510",
  displayFinancialStatus:"PARTIALLY_REFUNDED",
  currentSubtotalPriceSet:usd(50),
  totalRefundedSet:usd(150),
  transactions:[
   {kind:"SALE",status:"SUCCESS",amountSet:usd(100)},
   {kind:"CAPTURE",status:"SUCCESS",amountSet:usd(100)},
   {kind:"REFUND",status:"SUCCESS",amountSet:usd(150)}
  ]
 });
 // Adding SALE and CAPTURE could double count one settlement. A refund
 // greater than the proven individual payment is not automatically trusted.
 assert.deepEqual(classifyOrder(mixed),{
  eligible:false,reason:"mixed_settlement_kinds_unreconciled"
 });
 const result=await auditJsonl(Readable.from([JSON.stringify(mixed)+"\n"]),{
  asOf:"2026-11-20T00:00:00Z"
 });
 assert.equal(result.totals.eligible,0);
 assert.equal(result.totals.excluded.mixed_settlement_kinds_unreconciled,1);
 assert.equal(result.aggregates.lifetimeMerchandiseCents,0);
 assert.equal(result.aggregates.windowMerchandiseCents,0);
 const {verifyArchiveIntegrity}=require("../lib/crm-orders-ledger");
 const state={status:"COMPLETED",downloaded:true,
  archivedAt:"2026-11-20T00:00:00Z",rootObjectCount:"1",objectCount:"1"};
 assert.equal(verifyArchiveIntegrity(result,state).status,
  "BLOCKED_PAYMENT_OR_CURRENCY_EVIDENCE");
 // A single successful CAPTURE remains auditable. This rule only targets
 // ambiguous simultaneous settlement kinds.
 const captureOnly=order({
  transactions:[
   {kind:"AUTHORIZATION",status:"SUCCESS",amountSet:usd(100)},
   {kind:"CAPTURE",status:"SUCCESS",amountSet:usd(100)},
   {kind:"REFUND",status:"SUCCESS",amountSet:usd(20)}
  ]
 });
 assert.equal(classifyOrder(captureOnly).eligible,true);
});


test("completed export requires a real ISO archive timestamp before finance evidence is accepted",()=>{
 const {verifyArchiveIntegrity}=require("../lib/crm-orders-ledger");
 const sample={parsedLines:2,totals:{orders:1,lines:1,missingLineParent:0,duplicateOrderIds:0,
  duplicateLineItemIds:0,unverifiedLines:0,invalidOrderIds:0,invalidCustomerIds:0,
  duplicateTransactionIdsAcrossOrders:0,unverifiedLineFinancials:0,missingLineItems:0,
  missingOrderDate:0,futureOrders:0,refundMismatch:0,excluded:{}}};
 const state={status:"COMPLETED",downloaded:true,
  rootObjectCount:"1",objectCount:"2",archivedAt:"2026-11-20T00:00:00.000Z"};
 assert.equal(verifyArchiveIntegrity(sample,state).status,
  "PENDING_MANUAL_EXPORT_AND_FINANCIAL_RECONCILIATION");
 for(const archivedAt of [null,"",false,"not-a-date","2026-02-30T00:00:00Z",
  "2026-11-20","2026-11-20T24:00:00Z",42]){
  const result=verifyArchiveIntegrity(sample,{...state,archivedAt});
  assert.equal(result.status,"BLOCKED_EXPORT_NOT_ARCHIVED",String(archivedAt));
  assert.equal(result.verified,false);
 }
});

test("excluded Shopify orders still require valid historical dates before archive signoff",async()=>{
 const {verifyArchiveIntegrity}=require("../lib/crm-orders-ledger");
 const rows=[
  order({id:"gid://shopify/Order/881",test:true,createdAt:"not-an-instant",transactions:[]}),
  order({id:"gid://shopify/Order/882",cancelledAt:"2026-10-01T00:00:00Z",
   createdAt:"2026-12-01T00:00:00Z",transactions:[]}),
  order({id:"gid://shopify/Order/883",displayFinancialStatus:"REFUNDED",
   createdAt:"2026-02-30T00:00:00Z",currentSubtotalPriceSet:usd(0),
   totalRefundedSet:usd(100),transactions:[
    {id:"gid://shopify/OrderTransaction/8831",kind:"SALE",status:"SUCCESS",amountSet:usd(100)},
    {id:"gid://shopify/OrderTransaction/8832",kind:"REFUND",status:"SUCCESS",amountSet:usd(100)}
   ]})
 ];
 const audit=await auditJsonl(Readable.from([rows.map(JSON.stringify).join("\n")+"\n"]),{
  asOf:"2026-11-20T00:00:00Z"
 });
 assert.equal(audit.totals.orders,3);
 assert.equal(audit.totals.eligible,0);
 assert.equal(audit.totals.missingOrderDate,2);
 assert.equal(audit.totals.futureOrders,1);
 assert.equal(audit.totals.excluded.test,1);
 assert.equal(audit.totals.excluded.cancelled_settlement_unreconciled,1);
 assert.equal(audit.totals.excluded.fully_refunded_or_zero,1);
 assert.equal(audit.aggregates.lifetimeMerchandiseCents,0);
 const state={status:"COMPLETED",downloaded:true,archivedAt:"2026-11-20T00:00:00Z",
  rootObjectCount:"3",objectCount:"3"};
 assert.equal(verifyArchiveIntegrity(audit,state).status,"BLOCKED_ORDER_DATE_EVIDENCE");

 // Valid excluded orders need no merchandise line items and do not themselves
 // imply a finance-ready grade: even a complete archive remains manual-review only.
 const normal=await auditJsonl(Readable.from([
  JSON.stringify(order({id:"gid://shopify/Order/884",test:true,transactions:[]}))+"\n"
 ]),{asOf:"2026-11-20T00:00:00Z"});
 assert.equal(normal.totals.missingOrderDate,0);
 assert.equal(verifyArchiveIntegrity(normal,{...state,rootObjectCount:"1",objectCount:"1"}).status,
  "PENDING_MANUAL_EXPORT_AND_FINANCIAL_RECONCILIATION");
});

test("missing financial status quarantines historical Shopify rows and blocks archive signoff",async()=>{
 const {verifyArchiveIntegrity}=require("../lib/crm-orders-ledger");
 for(const status of [null,undefined,"", "UNKNOWN","paid"]){
  const row=order({displayFinancialStatus:status});
  assert.deepEqual(classifyOrder(row),{
   eligible:false,reason:"unverified_financial_status"
  });
 }
 for(const status of ["PENDING","AUTHORIZED","VOIDED","EXPIRED"]){
  assert.deepEqual(classifyOrder(order({displayFinancialStatus:status})),{
   eligible:false,reason:"financial_status"
  });
 }
 const purchase=order({id:"gid://shopify/Order/987",displayFinancialStatus:null,
  test:true,transactions:[]});
 const ledger=await auditJsonl(Readable.from([JSON.stringify(purchase)+"\n"]),{
  asOf:"2026-11-20T00:00:00Z"
 });
 assert.equal(ledger.totals.eligible,0);
 assert.equal(ledger.totals.excluded.unverified_financial_status,1);
 assert.equal(verifyArchiveIntegrity(ledger,{status:"COMPLETED",downloaded:true,
  archivedAt:"2026-11-20T00:00:00Z",rootObjectCount:"1",objectCount:"1"}).status,
  "BLOCKED_PAYMENT_OR_CURRENCY_EVIDENCE");
});


test("future archive completion timestamps cannot certify an earlier financial snapshot",()=>{
 const {verifyArchiveIntegrity}=require("../lib/crm-orders-ledger");
 const snapshot={asOf:"2026-11-20T00:00:00Z",parsedLines:2,totals:{
  orders:1,missingLineParent:0,duplicateOrderIds:0,duplicateLineItemIds:0,
  unverifiedLines:0,invalidOrderIds:0,invalidCustomerIds:0,
  duplicateTransactionIdsAcrossOrders:0,unverifiedLineFinancials:0,
  missingLineItems:0,missingOrderDate:0,futureOrders:0,refundMismatch:0,excluded:{}
 }};
 const state={status:"COMPLETED",downloaded:true,rootObjectCount:"1",objectCount:"2",
  archivedAt:"2026-11-20T00:00:01Z"};
 assert.equal(verifyArchiveIntegrity(snapshot,state).status,"BLOCKED_EXPORT_NOT_ARCHIVED");
 assert.equal(verifyArchiveIntegrity(snapshot,state).verified,false);
 // Boundary equality is valid; audit remains pending human reconciliation.
 assert.equal(verifyArchiveIntegrity(snapshot,{...state,
  archivedAt:"2026-11-20T00:00:00Z"}).status,
  "PENDING_MANUAL_EXPORT_AND_FINANCIAL_RECONCILIATION");
});


test("empty full-history archive must not enter manual reconciliation", () => {
 const {verifyArchiveIntegrity}=require("../lib/crm-orders-ledger");
 const zeroAudit={asOf:"2026-11-20T11:00:00Z",parsedLines:0,
  totals:{orders:0,lines:0,excluded:{}}};
 const archived={status:"COMPLETED",downloaded:true,
  archivedAt:"2026-11-20T10:00:00Z",rootObjectCount:"0",objectCount:"0"};
 const result=verifyArchiveIntegrity(zeroAudit,archived);
 assert.equal(result.status,"BLOCKED_EXPORT_EMPTY");
 assert.equal(result.verified,false);
 assert.equal(result.expectedOrders,0);
 // An archive claiming zero orders when one was parsed is a count mismatch.
 const inconsistent=verifyArchiveIntegrity({...zeroAudit,parsedLines:1,
  totals:{...zeroAudit.totals,orders:1}},archived);
 assert.equal(inconsistent.status,"BLOCKED_EXPORT_COUNTS_MISMATCH");
});


test("single-chunk newline-terminated JSONL records exceeding 4 MiB fail closed", async () => {
 const huge=JSON.stringify({id:"gid://shopify/Order/1",padding:"A".repeat(4*1024*1024)});
 await assert.rejects(
  auditJsonl(Readable.from([huge+"\n"]),{asOf:"2026-11-20T00:00:00Z"}),
  /Oversized JSONL line/
 );
});

test("unterminated oversized JSONL records fail closed, including UTF-8 multibyte text", async () => {
 const huge=JSON.stringify({id:"gid://shopify/Order/1",padding:"藏".repeat(1500000)});
 await assert.rejects(
  auditJsonl(Readable.from([huge]),{asOf:"2026-11-20T00:00:00Z"}),
  /Oversized JSONL line/
 );
});


test("paid order merchandise subtotal must match discounted line totals before archive or seven-customer review",async()=>{
 const {verifyArchiveIntegrity}=require("../lib/crm-orders-ledger");
 const customerIds=Array.from({length:7},(_,i)=>"gid://shopify/Customer/"+(12001+i));
 const rows=[];
 for(let i=0;i<7;i++){
  const orderId="gid://shopify/Order/"+(12001+i);
  rows.push(order({
   id:orderId,customer:{id:customerIds[i]},
   displayFinancialStatus:"PAID",currentSubtotalPriceSet:usd(100),
   totalRefundedSet:usd(0),
   transactions:[{id:"gid://shopify/OrderTransaction/"+(13001+i),
    kind:"SALE",status:"SUCCESS",amountSet:usd(100)}]
  }),{
   __parentId:orderId,id:"gid://shopify/LineItem/"+(14001+i),
   title:"Synthetic purchase",quantity:1,originalUnitPriceSet:usd(100),
   discountedTotalSet:usd(i===0?90:100)
  });
 }
 const config={
  asOf:"2026-11-21T00:00:00Z",sampleCustomerIds:customerIds,
  sampleExpectedOrderCounts:Object.fromEntries(customerIds.map(id=>[id,1]))
 };
 const state={status:"COMPLETED",downloaded:true,archivedAt:"2026-11-20T00:00:00Z",
  rootObjectCount:"7",objectCount:"14"};
 const wrong=await auditJsonl(Readable.from([rows.map(JSON.stringify).join("\n")+"\n"]),config);
 assert.equal(wrong.totals.eligible,7);
 assert.equal(wrong.totals.lineSubtotalMismatch,1);
 assert.equal(wrong.sampleAudit.status,"BLOCKED_SAMPLE_LINE_TOTAL_RECONCILIATION");
 assert.equal(wrong.sampleAudit.verified,false);
 assert.equal(verifyArchiveIntegrity(wrong,state).status,"BLOCKED_LINE_TOTAL_RECONCILIATION");
 // All line amounts reconciled: keep the existing human-review-only status.
 rows[1].discountedTotalSet=usd(100);
 const correct=await auditJsonl(Readable.from([rows.map(JSON.stringify).join("\n")+"\n"]),config);
 assert.equal(correct.totals.lineSubtotalMismatch,0);
 assert.equal(correct.sampleAudit.status,"PENDING_MANUAL_SHOPIFY_FINANCIAL_RECONCILIATION");
 assert.equal(correct.sampleAudit.verified,false);
 assert.equal(verifyArchiveIntegrity(correct,state).status,
  "PENDING_MANUAL_EXPORT_AND_FINANCIAL_RECONCILIATION");
});
