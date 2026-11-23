"use strict";
/**
 * Bridge from the full-history order auditor (PR #4) to the reviewed
 * 2026-11-12 lifetime tier policy. Pure, read-only, and intentionally fail-closed.
 *
 * PR #4 creates per-customer Map aggregates and an audit report. No grade
 * is approved until the entire historical export AND monetary audit have
 * been independently reconciled.
 */
const {grade}=require("./kbi-rfm");

function nonNegativeInt(x){return Number.isSafeInteger(x)&&x>=0;}
// These counters are produced by the consolidated full-history JSONL auditor.
// An older/incomplete report is not sufficient evidence for verified CRM grades.
const REQUIRED_INTEGRITY_COUNTERS=[
 "orders","eligible","missingLineParent","duplicateOrderIds",
 "duplicateLineItemIds","unverifiedLines","unverifiedLineFinancials",
 "missingLineItems","lineSubtotalMismatch","duplicateTransactionIdsAcrossOrders",
 "invalidOrderIds","invalidCustomerIds","missingOrderDate","futureOrders","refundMismatch"
];
const UNRESOLVED_FINANCIAL_EXCLUSIONS=[
 "unverified_currency","unverified_transactions","unverified_transaction_identity",
 "missing_settled_payment_evidence","duplicate_transaction_ids",
 "partially_paid_unreconciled","mixed_settlement_kinds_unreconciled",
 "unverified_financial_status","refunded_order_refund_mismatch",
 "refund_exceeds_captured","refunded_merchandise_balance_unreconciled",
 "partial_refund_without_refund_evidence"
];
function validAudit(a){
 if(!a||!a.totals||!(a.customers instanceof Map))return "audit_missing";
 const t=a.totals;
 for(const key of REQUIRED_INTEGRITY_COUNTERS){
  if(!nonNegativeInt(t[key]))return "audit_counters_missing";
 }
 if(t.orders<t.eligible)return "audit_orders_inconsistent";
 for(const key of REQUIRED_INTEGRITY_COUNTERS){
  if(key!=="orders"&&key!=="eligible"&&t[key]>0)
   return "audit_has_unresolved_exceptions";
 }
 const excluded=t.excluded;
 if(!excluded||typeof excluded!=="object"||Array.isArray(excluded))
  return "audit_exclusions_missing";
 for(const reason of UNRESOLVED_FINANCIAL_EXCLUSIONS){
  const n=excluded[reason]??0;
  if(!nonNegativeInt(n))return "audit_exclusions_invalid";
  if(n>0)return "audit_contains_unverified_payments";
 }
 // Source totals, per-customer rows and the published aggregates must
 // conserve the same eligible orders and settled USD cents. A partial Map
 // must never be approved just because its own rows appear well-formed.
 if(!nonNegativeInt(t.withinWindow))return "audit_window_count_missing";
 const summary=a.aggregates;
 if(!summary||typeof summary!=="object"||Array.isArray(summary))
  return "audit_aggregate_totals_missing";
 const fields=["lifetimeMerchandiseCents","windowMerchandiseCents",
  "customersWithWindowOrders","customersWithWindowSpendOver3000"];
 if(fields.some(key=>!nonNegativeInt(summary[key])))
  return "audit_aggregate_totals_invalid";
 const totals={orders:0,windowOrders:0,lifetimeMerchandiseCents:0,
  windowMerchandiseCents:0,customersWithWindowOrders:0,customersWithWindowSpendOver3000:0};
 for(const row of a.customers.values()){
  if(!row||!nonNegativeInt(row.orders)||!nonNegativeInt(row.windowOrders)||
     !nonNegativeInt(row.merchandiseCents)||!nonNegativeInt(row.windowMerchandiseCents)||
     row.windowOrders>row.orders||row.windowMerchandiseCents>row.merchandiseCents)
   return "audit_customer_metrics_invalid";
  for(const [name,value] of [["orders",row.orders],["windowOrders",row.windowOrders],
   ["lifetimeMerchandiseCents",row.merchandiseCents],
   ["windowMerchandiseCents",row.windowMerchandiseCents]]){
   totals[name]+=value;
   if(!Number.isSafeInteger(totals[name]))return "audit_aggregate_overflow";
  }
  if(row.windowOrders)totals.customersWithWindowOrders++;
  if(row.windowMerchandiseCents>300000)totals.customersWithWindowSpendOver3000++;
 }
 if(totals.orders!==t.eligible||totals.windowOrders!==t.withinWindow||
    fields.some(name=>totals[name]!==summary[name]))
  return "audit_customer_aggregate_mismatch";
 return null;
}
function asDate(v){
 const ms=typeof v==="number"?v:Date.parse(v||"");
 return Number.isFinite(ms)?new Date(ms).toISOString().slice(0,10):null;
}
function prepareCustomerLedger(aggregate,audit){
 if(!aggregate||!audit)return null;
 const Mcent=aggregate.windowMerchandiseCents;
 const F=aggregate.windowOrders,total=aggregate.orders;
 const lifetimeCents=aggregate.merchandiseCents;
 if(!nonNegativeInt(Mcent)||!nonNegativeInt(lifetimeCents)||
    !nonNegativeInt(F)||!nonNegativeInt(total)||F>total)
  return null;
 const lastDate=aggregate.lastAt==null?null:asDate(aggregate.lastAt);
 if(total>0&&!lastDate)return null;
 return {M:Mcent/100,F,lifetimeValidOrders:total,latestValidOrderDate:lastDate,
  lifetimeSpendUSD:lifetimeCents/100};
}
function prepareGrades(audit,{complete=false,financialReconciled=false,
 asOfDate,currency="USD"}={}){
 if(complete!==true)return {ok:false,reason:"full_history_export_incomplete",grades:new Map()};
 if(financialReconciled!==true)return {ok:false,reason:"financial_reconciliation_pending",grades:new Map()};
 if(currency!=="USD")return {ok:false,reason:"usd_ledger_required",grades:new Map()};
 const invalid=validAudit(audit);
 if(invalid)return {ok:false,reason:invalid,grades:new Map()};
 // A caller must not relabel historical rolling M/F as a different as-of day.
 // The original audited snapshot date is mandatory, even with an override.
 const day=asDate(audit.asOf);
 if(!day)return {ok:false,reason:"invalid_snapshot_date",grades:new Map()};
 if(asOfDate!==undefined&&asDate(asOfDate)!==day)
  return {ok:false,reason:"audit_snapshot_date_mismatch",grades:new Map()};
 if(audit.windowDays!==180)return {ok:false,reason:"not_180_day_snapshot",grades:new Map()};
 // The full customer master (including zero-order customers) must be joined
 // separately. A Map of paid customers alone cannot identify "never purchased".
 const grades=new Map();
 for(const [customerId,aggregate] of audit.customers){
  if(typeof customerId!=="string"||!customerId.startsWith("gid://shopify/Customer/"))
   return {ok:false,reason:"invalid_customer_identity",grades:new Map()};
  const ledger=prepareCustomerLedger(aggregate,audit);
  if(!ledger)return {ok:false,reason:"invalid_customer_aggregate",grades:new Map()};
  const result=grade({...ledger,asOfDate:day,currency,historyComplete:true,financialReconciled:true});
  if(result.status!=="verified")return {ok:false,reason:"inconsistent_aggregate_"+result.reason,grades:new Map()};
  grades.set(customerId,{...result,lifetimeSpendUSD:ledger.lifetimeSpendUSD,
   evidence:{source:"shopify_full_history_bulk",financialReconciled:true,
    auditDate:day,policyVersion:require("./crm-tier-policy").POLICY_VERSION}});
 }
 return {ok:true,reason:null,grades,missingNeverPurchased:true,
  note:"Join complete customer master for zero-order and unverified identity records."};
}
module.exports={prepareGrades,prepareCustomerLedger,validAudit};
