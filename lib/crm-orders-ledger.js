"use strict";
const {StringDecoder}=require("string_decoder");

// Read-only audit of Shopify Bulk JSONL. This is deliberately NOT an RFM writer.
// Shopify reports refunds at order and transaction levels. Avoid double-subtracting
// a refund from currentSubtotalPriceSet, which already reflects returned items.
const VALID_FINANCIAL=new Set(["PAID","PARTIALLY_PAID","PARTIALLY_REFUNDED","REFUNDED"]);
const SUCCESS=new Set(["SUCCESS"]);
function money(bag){
 const m=bag?.shopMoney;
 if(!m||m.currencyCode!=="USD")return null;
 // Missing Shopify monetary evidence must never silently become $0.
 // Validate the decimal amount before converting to integer USD cents.
 const value=m.amount;
 if(typeof value!=="string"||!/^\d+(?:\.\d+)?$/.test(value.trim()))return null;
 const amount=Number(value);
 if(!Number.isFinite(amount)||amount<0||amount>Number.MAX_SAFE_INTEGER/100)return null;
 return Math.round(amount*100);
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
 // Shopify currentSubtotal is the full merchandise value, not the amount
 // actually settled on a partially paid order. Hold it for reconciliation.
 if(order.displayFinancialStatus==="PARTIALLY_PAID")
  return {eligible:false,reason:"partially_paid_unreconciled"};
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

function createAudit({asOf=new Date().toISOString(),windowDays=180,sampleCustomerIds=[]}={}){
 const asOfMs=Date.parse(asOf);
 if(!Number.isFinite(asOfMs)||!Number.isInteger(windowDays)||windowDays<1)
  throw Error("Invalid audit window");
 const windowStart=asOfMs-windowDays*86400000;
 // Sample IDs are supplied through a private runtime setting, never through
 // the public workbench. The result is evidence, not a financial signoff.
 if(!Array.isArray(sampleCustomerIds)||sampleCustomerIds.length>7||
    new Set(sampleCustomerIds).size!==sampleCustomerIds.length||
    sampleCustomerIds.some(id=>typeof id!=="string"||!/^gid:\/\/shopify\/Customer\/\d+$/.test(id)))
  throw Error("Invalid private Shopify financial audit sample identities");
 const totals={orders:0,lines:0,eligible:0,excluded:{},refundMismatch:0,
  missingLineParent:0,duplicateOrderIds:0,unverifiedLines:0,
  missingOrderDate:0,futureOrders:0,withinWindow:0};
 const customers=new Map(),orders=new Map();
 const samples=new Map(sampleCustomerIds.map(customerId=>[customerId,{
  customerId,found:false,totalOrders:0,effectiveOrders:0,windowOrders:0,
  lifetimeMerchandiseCents:0,windowMerchandiseCents:0,refundMismatch:0,
  excluded:{},orderEvidence:[],evidenceTruncated:false,invalidOrderIds:0,duplicateOrderIds:0
 }]));
 function recordSample(record,classified){
  const sample=samples.get(record?.customer?.id);
  if(!sample)return;
  sample.found=true;sample.totalOrders++;
  // An audit cannot be signed off without original, valid Shopify order IDs.
  if(!/^gid:\/\/shopify\/Order\/\d+$/.test(String(record?.id||"")))sample.invalidOrderIds++;
  const at=Date.parse(record.createdAt||"");
  const validDate=Number.isFinite(at)&&at<=asOfMs;
  const eligible=classified.eligible&&validDate;
  const reason=eligible?null:!classified.eligible?classified.reason:
   !Number.isFinite(at)?"missing_order_date":"future_order";
  if(eligible){
   sample.effectiveOrders++;
   sample.lifetimeMerchandiseCents+=classified.netMerchandiseCents;
   if(at>=windowStart){
    sample.windowOrders++;
    sample.windowMerchandiseCents+=classified.netMerchandiseCents;
   }
   if(classified.refundMismatch)sample.refundMismatch++;
  }else sample.excluded[reason]=(sample.excluded[reason]||0)+1;
  // Bound the private response. Extensive histories require separate review.
  if(sample.orderEvidence.length>=100){sample.evidenceTruncated=true;return;}
  sample.orderEvidence.push({
   orderId:String(record.id||""),createdAt:validDate?new Date(at).toISOString():null,
   financialStatus:record.displayFinancialStatus||null,
   eligible,reason,netMerchandiseCents:eligible?classified.netMerchandiseCents:null,
   shopifyRefundCents:classified.refundCents??null,
   transactionRefundCents:classified.transactionRefundCents??null,
   refundMismatch:!!classified.refundMismatch
  });
 }
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
  if(orders.has(record.id)){
   totals.duplicateOrderIds++;
   const sample=samples.get(record?.customer?.id);
   if(sample)sample.duplicateOrderIds++;
   return;
  }
  const classified=classifyOrder(record);
  orders.set(record.id,{lines:0,eligible:classified.eligible});
  recordSample(record,classified);
  if(!classified.eligible){totals.excluded[classified.reason]=(totals.excluded[classified.reason]||0)+1;return;}
  // Orders without a trustworthy creation date, or dated after the as-of
  // boundary, cannot contribute to lifetime or rolling-window figures.
  // Keep the raw order and flag it for review rather than inventing a period.
  const at=Date.parse(classified.createdAt||"");
  if(!Number.isFinite(at)){
   totals.missingOrderDate++;
   totals.excluded.missing_order_date=(totals.excluded.missing_order_date||0)+1;
   return;
  }
  if(at>asOfMs){
   totals.futureOrders++;
   totals.excluded.future_order=(totals.excluded.future_order||0)+1;
   return;
  }
  totals.eligible++;
  if(classified.refundMismatch)totals.refundMismatch++;
  const cust=customers.get(classified.customerId)||{orders:0,merchandiseCents:0,firstAt:null,lastAt:null,
   windowOrders:0,windowMerchandiseCents:0};
  cust.orders++;cust.merchandiseCents+=classified.netMerchandiseCents;
  // Historical totals and the rolling 180-day window come from the same
  // validated set of orders, but remain separately measured.
  cust.firstAt=cust.firstAt===null?at:Math.min(cust.firstAt,at);
  cust.lastAt=cust.lastAt===null?at:Math.max(cust.lastAt,at);
  if(at>=windowStart){
   totals.withinWindow++;cust.windowOrders++;
   cust.windowMerchandiseCents+=classified.netMerchandiseCents;
  }
  customers.set(classified.customerId,cust);
 }
 return {totals,customers,consume,asOf,windowDays,samples};
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
 const sampleRows=[...audit.samples.values()];
 const matched=sampleRows.filter(s=>s.found).length;
 const truncated=sampleRows.some(s=>s.evidenceTruncated);
 const sampleAudit={
  requested:sampleRows.length,matched,
  status:sampleRows.length!==7?"BLOCKED_REQUIRE_EXACTLY_SEVEN_SAMPLE_CUSTOMERS":
   matched!==7?"BLOCKED_SAMPLE_CUSTOMERS_MISSING":
   sampleRows.some(s=>s.invalidOrderIds)?"BLOCKED_SAMPLE_ORDER_IDS_INVALID":
   sampleRows.some(s=>s.duplicateOrderIds)?"BLOCKED_SAMPLE_ORDER_IDS_DUPLICATED":
   truncated?"BLOCKED_SAMPLE_ORDER_EVIDENCE_TRUNCATED":
   "PENDING_MANUAL_SHOPIFY_FINANCIAL_RECONCILIATION",
  // Even a completely matched sample is never an automatic signoff.
  verified:false,customers:sampleRows
 };
 return {totals:audit.totals,aggregates,asOf:audit.asOf,windowDays:audit.windowDays,
  uniqueCustomers:audit.customers.size,parsedLines:line,sampleAudit};
}

module.exports={money,transactionTotals,classifyOrder,createAudit,auditJsonl};
