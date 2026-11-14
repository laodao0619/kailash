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
 if(typeof value!=="string")return null;
 const normalized=value.trim();
 // Never round a fractional USD cent into an invented settled amount.
 if(!/^\d+(?:\.\d{1,2})?$/.test(normalized))return null;
 const [whole,minor=""]=normalized.split(".");
 const cents=Number(whole)*100+Number(minor.padEnd(2,"0"));
 if(!Number.isSafeInteger(cents)||cents<0)return null;
 return cents;
}
function addCents(a,b){
 const result=a+b;
 if(!Number.isSafeInteger(a)||!Number.isSafeInteger(b)||!Number.isSafeInteger(result)||a<0||b<0)
  throw Error("Unsafe USD cent aggregate; financial audit blocked");
 return result;
}
function transactionTotals(order){
 let captured=0,refunded=0,unknown=0,duplicate=0,unverifiedIdentity=0;
 const seenTransactionIds=new Set();
 for(const t of order.transactions||[]){
  if(!SUCCESS.has(t.status)||!["SALE","CAPTURE","REFUND"].includes(t.kind))continue;
  // Only an identifiable settled transaction is auditable. Unidentified
  // amounts cannot establish a unique payment, capture or refund.
  if(typeof t.id!=="string"||!/^gid:\/\/shopify\/OrderTransaction\/\d+$/.test(t.id)){
   unverifiedIdentity++;continue;
  }
  if(seenTransactionIds.has(t.id)){duplicate++;continue;}
  seenTransactionIds.add(t.id);
  const cents=money(t.amountSet);
  if(cents===null){unknown++;continue;}
  if(t.kind==="REFUND")refunded=addCents(refunded,cents);
  else if(t.kind==="SALE"||t.kind==="CAPTURE")captured=addCents(captured,cents);
 }
 return {captured,refunded,unknown,duplicate,unverifiedIdentity};
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
 if(order.displayFinancialStatus==="REFUNDED"||net===0){
  // A zero-merchandise order is not an effective purchase. A refund claimed
  // by Shopify must nevertheless reconcile to successful refund transactions.
  // Otherwise fully refunded orders could conceal missing financial evidence.
  if(order.displayFinancialStatus==="REFUNDED"||refund>0){
   const refunded=transactionTotals(order);
   if(refunded.duplicate)return {eligible:false,reason:"duplicate_transaction_ids"};
   if(refunded.unverifiedIdentity)return {eligible:false,reason:"unverified_transaction_identity"};
   if(refunded.unknown)return {eligible:false,reason:"unverified_transactions"};
   // A successful refund without a documented settled payment cannot prove
   // the underlying transaction or its net effect, even for an F-excluded order.
   if(refunded.captured===0)return {eligible:false,reason:"missing_settled_payment_evidence"};
   // Refunds larger than the proven settled payment need a manual finance review.
   if(refunded.refunded>refunded.captured)return {eligible:false,reason:"refund_exceeds_captured"};
   if(refund===0||refunded.refunded!==refund)
    return {eligible:false,reason:"refunded_order_refund_mismatch"};
  }
  return {eligible:false,reason:"fully_refunded_or_zero"};
 }
 const paid=transactionTotals(order);
 if(paid.duplicate)return {eligible:false,reason:"duplicate_transaction_ids"};
 if(paid.unverifiedIdentity)return {eligible:false,reason:"unverified_transaction_identity"};
 if(paid.unknown)return {eligible:false,reason:"unverified_transactions"};
 // PAID status alone does not prove settlement. Missing, failed or
 // authorization-only transactions must not enter CRM lifetime/180d M/F.
 if(paid.captured===0)return {eligible:false,reason:"missing_settled_payment_evidence"};
 if(paid.refunded>paid.captured)return {eligible:false,reason:"refund_exceeds_captured"};
 // Different payment and merchandise amounts include shipping/tax, so the
 // transaction sum is audit evidence, not a replacement for merchandise net.
 return {eligible:true,customerId:order.customer.id,orderId:order.id,createdAt:order.createdAt,
  processedAt:order.processedAt,netMerchandiseCents:net,refundCents:refund,
  capturedCents:paid.captured,transactionRefundCents:paid.refunded,
  refundMismatch:paid.refunded!==refund};
}

function createAudit({asOf=new Date().toISOString(),windowDays=180,
 sampleCustomerIds=[],sampleExpectedOrderCounts={}}={}){
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
 // Separate customer-level Shopify order counts are a completeness check, not
 // a replacement for the private Bulk ledger. A missing count blocks signoff.
 if(!sampleExpectedOrderCounts||typeof sampleExpectedOrderCounts!=="object"||
    Array.isArray(sampleExpectedOrderCounts)||
    Object.entries(sampleExpectedOrderCounts).some(([id,count])=>
     !sampleCustomerIds.includes(id)||!Number.isSafeInteger(count)||count<0))
  throw Error("Invalid private Shopify sample order-count evidence");
 const totals={orders:0,lines:0,eligible:0,excluded:{},refundMismatch:0,
  missingLineParent:0,duplicateOrderIds:0,duplicateLineItemIds:0,unverifiedLines:0,unverifiedLineFinancials:0,
  missingLineItems:0,
  invalidOrderIds:0,invalidCustomerIds:0,
  missingOrderDate:0,futureOrders:0,withinWindow:0};
 const customers=new Map(),orders=new Map(),lineItemIds=new Set();
 const samples=new Map(sampleCustomerIds.map(customerId=>[customerId,{
  customerId,expectedOrderCount:Object.prototype.hasOwnProperty.call(sampleExpectedOrderCounts,customerId)
   ?sampleExpectedOrderCounts[customerId]:null,
  found:false,totalOrders:0,effectiveOrders:0,windowOrders:0,
  lifetimeMerchandiseCents:0,windowMerchandiseCents:0,refundMismatch:0,
  excluded:{},orderEvidence:[],evidenceTruncated:false,invalidOrderIds:0,duplicateOrderIds:0,
  unverifiedLineFinancials:0,missingLineItems:0,duplicateLineItemIds:0,invalidLineItems:0
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
   sample.lifetimeMerchandiseCents=addCents(sample.lifetimeMerchandiseCents,classified.netMerchandiseCents);
   if(at>=windowStart){
    sample.windowOrders++;
    sample.windowMerchandiseCents=addCents(sample.windowMerchandiseCents,classified.netMerchandiseCents);
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
   const sample=samples.get(parent.customerId);
   const lineId=String(record.id||"");
   // Root and child counts cannot establish unique financial item identities.
   // Duplicate or malformed line IDs must never count as trusted evidence.
   if(!/^gid:\/\/shopify\/LineItem\/\d+$/.test(lineId)||
      typeof record.title!=="string"||!record.title.trim()){
    totals.unverifiedLines++;
    if(sample)sample.invalidLineItems++;
   }
   if(lineId&&lineItemIds.has(lineId)){
    totals.duplicateLineItemIds++;
    if(sample)sample.duplicateLineItemIds++;
   }else if(lineId)lineItemIds.add(lineId);
   // Child lines are financial source evidence. A matching parent/order count
   // cannot prove each purchased item's quantity, currency or original price.
   // Allow zero quantity (returned items); reject negative or missing counts.
   if(!Number.isSafeInteger(record.quantity)||record.quantity<0||
      money(record.originalUnitPriceSet)===null||money(record.discountedTotalSet)===null){
    totals.unverifiedLineFinancials++;
    if(sample)sample.unverifiedLineFinancials++;
   }
   return;
  }
  totals.orders++;
  // Counts can match Shopify's export while a root ID is malformed. Never
  // accept such rows as sufficient evidence for a customer-level ledger.
  if(!/^gid:\/\/shopify\/Order\/\d+$/.test(String(record?.id||"")))totals.invalidOrderIds++;
  const customerId=record?.customer?.id;
  // Missing customer IDs are an explicit no_customer exclusion (e.g. deleted
  // account); supplied but malformed IDs must fail full-export integrity.
  if(customerId!=null&&!/^gid:\/\/shopify\/Customer\/\d+$/.test(String(customerId)))
   totals.invalidCustomerIds++;
  if(orders.has(record.id)){
   totals.duplicateOrderIds++;
   const sample=samples.get(record?.customer?.id);
   if(sample)sample.duplicateOrderIds++;
   return;
  }
  const classified=classifyOrder(record);
  orders.set(record.id,{lines:0,eligible:classified.eligible,customerId});
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
  cust.orders++;cust.merchandiseCents=addCents(cust.merchandiseCents,classified.netMerchandiseCents);
  // Historical totals and the rolling 180-day window come from the same
  // validated set of orders, but remain separately measured.
  cust.firstAt=cust.firstAt===null?at:Math.min(cust.firstAt,at);
  cust.lastAt=cust.lastAt===null?at:Math.max(cust.lastAt,at);
  if(at>=windowStart){
   totals.withinWindow++;cust.windowOrders++;
   cust.windowMerchandiseCents=addCents(cust.windowMerchandiseCents,classified.netMerchandiseCents);
  }
  customers.set(classified.customerId,cust);
 }
 return {totals,customers,orders,consume,asOf,windowDays,samples};
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
  aggregates.lifetimeMerchandiseCents=addCents(aggregates.lifetimeMerchandiseCents,customer.merchandiseCents);
  aggregates.windowMerchandiseCents=addCents(aggregates.windowMerchandiseCents,customer.windowMerchandiseCents);
  if(customer.windowOrders)aggregates.customersWithWindowOrders++;
  if(customer.windowMerchandiseCents>300000)aggregates.customersWithWindowSpendOver3000++;
 }
 // Shopify's completed root/order count does not prove its child line-item
 // graph is complete. A settled, positive-merchandise order must have at
 // least one associated line item before financial evidence is reviewable.
 for(const order of audit.orders.values()){
  if(!order.eligible||order.lines!==0)continue;
  audit.totals.missingLineItems++;
  const sample=audit.samples.get(order.customerId);
  if(sample)sample.missingLineItems++;
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
   sampleRows.some(s=>s.duplicateLineItemIds)?"BLOCKED_SAMPLE_LINE_ITEM_IDS_DUPLICATED":
   sampleRows.some(s=>s.invalidLineItems)?"BLOCKED_SAMPLE_LINE_ITEM_IDENTITIES_INVALID":
   sampleRows.some(s=>s.unverifiedLineFinancials)?"BLOCKED_SAMPLE_LINE_ITEM_FINANCIAL_EVIDENCE":
   sampleRows.some(s=>s.missingLineItems)?"BLOCKED_SAMPLE_MISSING_LINE_ITEMS":
   truncated?"BLOCKED_SAMPLE_ORDER_EVIDENCE_TRUNCATED":
   sampleRows.some(s=>s.expectedOrderCount===null)?"BLOCKED_SAMPLE_SOURCE_COUNTS_MISSING":
   sampleRows.some(s=>s.expectedOrderCount!==s.totalOrders)?"BLOCKED_SAMPLE_SOURCE_COUNT_MISMATCH":
   // Sample rows must not appear manual-ready when even one financial entry
   // has an unresolved refund or payment evidence discrepancy.
   sampleRows.some(s=>s.refundMismatch>0||s.excluded.refunded_order_refund_mismatch>0||s.excluded.refund_exceeds_captured>0)
    ?"BLOCKED_SAMPLE_REFUND_RECONCILIATION":
   sampleRows.some(s=>[
     "unverified_currency","unverified_transactions","unverified_transaction_identity","missing_settled_payment_evidence",
     "duplicate_transaction_ids","partially_paid_unreconciled"
    ].some(reason=>(s.excluded[reason]||0)>0))
    ?"BLOCKED_SAMPLE_FINANCIAL_EVIDENCE":
   "PENDING_MANUAL_SHOPIFY_FINANCIAL_RECONCILIATION",
  // Even a completely matched sample is never an automatic signoff.
  verified:false,customers:sampleRows
 };
 return {totals:audit.totals,aggregates,asOf:audit.asOf,windowDays:audit.windowDays,
  uniqueCustomers:audit.customers.size,parsedLines:line,sampleAudit};
}

function verifiedCount(value){
 if(typeof value==="string"&&!/^\d+$/.test(value))return null;
 if(typeof value!=="string"&&typeof value!=="number")return null;
 const number=Number(value);
 return Number.isSafeInteger(number)&&number>=0?number:null;
}
// This checks only raw export consistency, NOT correctness of refund accounting.
// Never claim a full-history audit when Shopify's expected root/total counts
// disagree with the archived JSONL, or when child lines have no valid parent.
function verifyArchiveIntegrity(audit,state){
 const expectedOrders=verifiedCount(state?.rootObjectCount);
 const expectedObjects=verifiedCount(state?.objectCount);
 const observedOrders=audit?.totals?.orders;
 const observedObjects=audit?.parsedLines;
 const basic={expectedOrders,expectedObjects,observedOrders,observedObjects,verified:false};
 if(state?.status!=="COMPLETED"||state?.downloaded!==true||!state?.archivedAt)
  return {...basic,status:"BLOCKED_EXPORT_NOT_ARCHIVED"};
 if(expectedOrders===null||expectedObjects===null||expectedObjects<expectedOrders)
  return {...basic,status:"BLOCKED_EXPORT_COUNTS_MISSING_OR_INVALID"};
 if(expectedOrders!==observedOrders||expectedObjects!==observedObjects)
  return {...basic,status:"BLOCKED_EXPORT_COUNTS_MISMATCH"};
 if(audit.totals.missingLineParent||audit.totals.duplicateOrderIds||
    audit.totals.duplicateLineItemIds||audit.totals.unverifiedLines||
    audit.totals.invalidOrderIds||audit.totals.invalidCustomerIds)
  return {...basic,status:"BLOCKED_JSONL_ASSOCIATION_INTEGRITY"};
 if(audit.totals.unverifiedLineFinancials)
  return {...basic,status:"BLOCKED_LINE_ITEM_FINANCIAL_EVIDENCE"};
 if(audit.totals.missingLineItems)
  return {...basic,status:"BLOCKED_ORDER_LINE_ITEMS_MISSING"};
 // A count-consistent export can still have untrustworthy dates, refunds or
 // settlement evidence. These must be explicit blockers, not manual-ready.
 if(audit.totals.missingOrderDate||audit.totals.futureOrders)
  return {...basic,status:"BLOCKED_ORDER_DATE_EVIDENCE"};
 const excluded=audit.totals.excluded||{};
 if(audit.totals.refundMismatch||excluded.refunded_order_refund_mismatch>0||excluded.refund_exceeds_captured>0)
  return {...basic,status:"BLOCKED_REFUND_RECONCILIATION"};
 // Partially paid orders are excluded from F/M, but the full historical
 // finance ledger still needs explicit settlement reconciliation.
 if(excluded.partially_paid_unreconciled>0)
  return {...basic,status:"BLOCKED_PARTIAL_PAYMENT_RECONCILIATION"};
 if(["unverified_currency","unverified_transactions","unverified_transaction_identity","missing_settled_payment_evidence","duplicate_transaction_ids"]
   .some(reason=>excluded[reason]>0))
  return {...basic,status:"BLOCKED_PAYMENT_OR_CURRENCY_EVIDENCE"};
 return {...basic,status:"PENDING_MANUAL_EXPORT_AND_FINANCIAL_RECONCILIATION"};
}

module.exports={money,transactionTotals,classifyOrder,createAudit,auditJsonl,verifyArchiveIntegrity};
