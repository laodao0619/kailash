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
function validAudit(a){
 if(!a||!a.totals||!(a.customers instanceof Map))return "audit_missing";
 const t=a.totals;
 for(const key of ["orders","eligible","missingLineParent","duplicateOrderIds","unverifiedLines","missingOrderDate","futureOrders","refundMismatch"]){
  if(!nonNegativeInt(t[key]))return "audit_counters_missing";
 }
 if(t.orders<t.eligible)return "audit_orders_inconsistent";
 for(const key of ["missingLineParent","duplicateOrderIds","unverifiedLines","missingOrderDate","futureOrders","refundMismatch"]){
  if(t[key]>0)return "audit_has_unresolved_exceptions";
 }
 if(t.excluded?.unverified_currency>0||t.excluded?.unverified_transactions>0)
  return "audit_contains_unverified_payments";
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
 const day=asDate(asOfDate||audit.asOf);
 if(!day)return {ok:false,reason:"invalid_snapshot_date",grades:new Map()};
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
