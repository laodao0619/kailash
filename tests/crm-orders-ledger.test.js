"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {Readable}=require("node:stream");
const {classifyOrder,auditJsonl}=require("../lib/crm-orders-ledger");
const usd=n=>({shopMoney:{amount:String(n),currencyCode:"USD"}});
function order(overrides={}){
 return {id:"gid://shopify/Order/1",createdAt:"2026-08-01T12:00:00Z",processedAt:"2026-08-01T12:00:00Z",
  customer:{id:"gid://shopify/Customer/1"},displayFinancialStatus:"PARTIALLY_REFUNDED",
  currentSubtotalPriceSet:usd(80),totalRefundedSet:usd(20),transactions:[
   {kind:"SALE",status:"SUCCESS",amountSet:usd(100)},
   {kind:"REFUND",status:"SUCCESS",amountSet:usd(20)}],...overrides};
}
test("net merchandise isn't reduced a second time by refund",()=>{
 const x=classifyOrder(order());assert.equal(x.eligible,true);
 assert.equal(x.netMerchandiseCents,8000);assert.equal(x.transactionRefundCents,2000);
 assert.equal(x.refundMismatch,false);
});
test("failed refund transactions are excluded from audit",()=>{
 const x=classifyOrder(order({transactions:[{kind:"REFUND",status:"FAILURE",amountSet:usd(20)}]}));
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
