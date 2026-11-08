"use strict";
const {StringDecoder}=require("string_decoder");

// Read-only audit of Shopify Bulk JSONL. This is deliberately NOT an RFM writer.
// Shopify reports refunds at order and transaction levels. Avoid double-subtracting
// a refund from currentSubtotalPriceSet, which already reflects returned items.
const VALID_FINANCIAL=new Set(["PAID","PARTIALLY_PAID","PARTIALLY_REFUNDED","REFUNDED"]);
const SUCCESS=new Set(["SUCCESS"]);
function money(bag){
 const m=bag?.shopMoney;
 if(!m||m.currencyCode!=="USD"||!Number.isFinite(Number(m.amount)))return null;
 return Math.round(Number(m.amount)*100);
}
function transactionTotals(order){
 let captured=0,refunded=0,unknown=0;
 for(const t of order.transactions||[]){
  if(!SUCCESS.has(t.status))continue;
  const cents=money(t.amountSet);
  if(cents===null){unknown++;continue;}
  if(t.kind==="REFUND")refunded+=cents;
  else if(t.kind==="SALE"||t.kind==="CAPTURE")captured+=cents;
 }
 return {captured,refunded,unknown};
}
function classifyOrder(order){
 if(!order?.id||!order.customer?.id)return {eligible:false,reason:"no_customer"};
 if(order.test)return {eligible:false,reason:"test"};
 if(order.cancelledAt)return {eligible:false,reason:"cancelled"};
 if(!VALID_FINANCIAL.has(order.displayFinancialStatus))return {eligible:false,reason:"financial_status"};
 const net=money(order.currentSubtotalPriceSet);
 const refund=money(order.totalRefundedSet);
 if(net===null||refund===null||net<0)return {eligible:false,reason:"unverified_currency"};
 // A fully refunded or zero-merchandise order does not count as an effective
 // purchase for the CRM F metric. Keep it in the raw export for audit.
 if(order.displayFinancialStatus==="REFUNDED"||net===0)
  return {eligible:false,reason:"fully_refunded_or_zero"};
 const paid=transactionTotals(order);
 if(paid.unknown)return {eligible:false,reason:"unverified_transactions"};
 // Different payment and merchandise amounts include shipping/tax, so the
 // transaction sum is audit evidence, not a replacement for merchandise net.
 return {eligible:true,customerId:order.customer.id,orderId:order.id,createdAt:order.createdAt,
  processedAt:order.processedAt,netMerchandiseCents:net,refundCents:refund,
  capturedCents:paid.captured,transactionRefundCents:paid.refunded,
  refundMismatch:paid.refunded!==refund};
}

function createAudit({asOf=new Date().toISOString(),windowDays=180}={}){
 const asOfMs=Date.parse(asOf);
 if(!Number.isFinite(asOfMs)||!Number.isInteger(windowDays)||windowDays<1)
  throw Error("Invalid audit window");
 const windowStart=asOfMs-windowDays*86400000;
 const totals={orders:0,lines:0,eligible:0,excluded:{},refundMismatch:0,
  missingLineParent:0,duplicateOrderIds:0,unverifiedLines:0,
  missingOrderDate:0,futureOrders:0,withinWindow:0};
 const customers=new Map(),orders=new Map();
 function consume(record){
  if(record.__parentId){
   totals.lines++;
   const parent=orders.get(record.__parentId);
   if(!parent){totals.missingLineParent++;return;}
   parent.lines++;
   if(!record.id||!record.title)totals.unverifiedLines++;
   return;
  }
  totals.orders++;
  if(orders.has(record.id)){totals.duplicateOrderIds++;return;}
  const classified=classifyOrder(record);
  orders.set(record.id,{lines:0,eligible:classified.eligible});
  if(!classified.eligible){totals.excluded[classified.reason]=(totals.excluded[classified.reason]||0)+1;return;}
  totals.eligible++;
  if(classified.refundMismatch)totals.refundMismatch++;
  const cust=customers.get(classified.customerId)||{orders:0,merchandiseCents:0,firstAt:null,lastAt:null,
   windowOrders:0,windowMerchandiseCents:0};
  cust.orders++;cust.merchandiseCents+=classified.netMerchandiseCents;
  // Shopify's orders_placed segment uses order creation time. Keep all-time
  // figures separate from the rolling window; never infer a CRM grade here.
  const at=Date.parse(classified.createdAt||"");
  if(Number.isFinite(at)){
   cust.firstAt=cust.firstAt===null?at:Math.min(cust.firstAt,at);
   cust.lastAt=cust.lastAt===null?at:Math.max(cust.lastAt,at);
   if(at>asOfMs)totals.futureOrders++;
   else if(at>=windowStart){
    totals.withinWindow++;cust.windowOrders++;
    cust.windowMerchandiseCents+=classified.netMerchandiseCents;
   }
  }else totals.missingOrderDate++;
  customers.set(classified.customerId,cust);
 }
 return {totals,customers,consume,asOf,windowDays};
}

async function auditJsonl(stream,options){
 const audit=createAudit(options);let buffer="",line=0;const decoder=new StringDecoder("utf8");
 for await(const chunk of stream){
  buffer+=decoder.write(Buffer.from(chunk));
  let i;
  while((i=buffer.indexOf("\n"))!==-1){
   const row=buffer.slice(0,i).trim();buffer=buffer.slice(i+1);
   if(row){line++;audit.consume(JSON.parse(row));}
  }
  if(buffer.length>4*1024*1024)throw Error("Oversized JSONL line");
 }
 buffer+=decoder.end();
 if(buffer.trim()){line++;audit.consume(JSON.parse(buffer));}
 const aggregates={lifetimeMerchandiseCents:0,windowMerchandiseCents:0,
  customersWithWindowOrders:0,customersWithWindowSpendOver3000:0};
 for(const customer of audit.customers.values()){
  aggregates.lifetimeMerchandiseCents+=customer.merchandiseCents;
  aggregates.windowMerchandiseCents+=customer.windowMerchandiseCents;
  if(customer.windowOrders)aggregates.customersWithWindowOrders++;
  if(customer.windowMerchandiseCents>300000)aggregates.customersWithWindowSpendOver3000++;
 }
 return {totals:audit.totals,aggregates,asOf:audit.asOf,windowDays:audit.windowDays,
  uniqueCustomers:audit.customers.size,parsedLines:line};
}

module.exports={money,transactionTotals,classifyOrder,createAudit,auditJsonl};
