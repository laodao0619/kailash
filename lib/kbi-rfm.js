"use strict";
/**
 * Kailash CRM grading policy, effective 2026-11-16.
 * Input figures MUST come from reconciled USD net order ledger, not
 * Shopify lifetime amountSpent or the 2026-10-23 HTML snapshot.
 *
 * CRM tier = lifetimeSpendUSD with at least one valid purchase in last 180d.
 * RFM M = verified net USD spend in last 180d
 * R = days since latest valid purchase (date precision)
 * F = valid paid orders in last 180d
 * Lifetime purchase proof and complete history are required for dormant/never.
 */
const {TIERS,POLICY_VERSION,BASIS,classify}=require("./crm-lifetime-tier");
const DAY_MS=86400000;
function isDay(v){return /^\d{4}-\d{2}-\d{2}$/.test(String(v||""))&&
 Number.isFinite(Date.parse(v+"T00:00:00.000Z"))&&
 new Date(v+"T00:00:00.000Z").toISOString().slice(0,10)===v;}
function dayOf(iso){
 if(typeof iso!=="string")return null;
 const date=new Date(iso);
 return Number.isFinite(date.getTime())?date.toISOString().slice(0,10):null;
}
function daysBetween(a,b){
 const x=Date.parse(a+"T00:00:00.000Z"),y=Date.parse(b+"T00:00:00.000Z");
 return Math.round((y-x)/DAY_MS);
}
function unknown(reason,values={}){
 return {tier:null,status:"unverified",reason,M:null,R:null,F:null,...values,
  policyVersion:POLICY_VERSION,basis:BASIS};
}
/**
 * Values are numbers from a fully reconciled source; NOT inferred.
 * ready requires all three metrics plus verified lifetime history.
 * recentOrderDate and asOfDate are strict ISO dates yyyy-mm-dd.
 */
function grade(input){
 const x=input||{};
 const asOf=x.asOfDate||new Date().toISOString().slice(0,10);
 if(!isDay(asOf))return unknown("invalid_as_of_date");
 if(x.historyComplete!==true)return unknown("history_incomplete");
 if(x.financialReconciled!==true)return unknown("net_ledger_not_reconciled");
 if(x.currency!=="USD")return unknown("net_usd_required");
 const M=x.M,F=x.F,total=x.lifetimeValidOrders;
 if(!Number.isFinite(x.lifetimeSpendUSD)||x.lifetimeSpendUSD<0)return unknown("missing_lifetime_spend");
 if(!Number.isFinite(M)||M<0||!Number.isInteger(F)||F<0||
    !Number.isInteger(total)||total<0)
  return unknown("invalid_or_missing_metrics");
 if(F>total)return unknown("recent_orders_exceed_lifetime");
 const latest=x.latestValidOrderDate;
 const day=dayOf(latest);
 if(total===0){
  if(F!==0||M!==0||x.lifetimeSpendUSD!==0||latest)return unknown("never_purchased_inconsistent");
  return {tier:"从未购买",status:"verified",reason:"zero_lifetime_orders",M,R:null,F,
   policyVersion:POLICY_VERSION,basis:BASIS};
 }
 if(!day||day>asOf)return unknown("invalid_last_purchase");
 const R=daysBetween(day,asOf);
 if((R<=180&&F===0)||(R>180&&F>0))
  return unknown("activity_mismatch");
 if(R>180){
  if(M!==0)return unknown("dormant_nonzero_recent_spend");
  return {tier:"沉睡",status:"verified",reason:"last_purchase_over_180_days",M,R,F,
   policyVersion:POLICY_VERSION,basis:BASIS};
 }
 const result=classify({lifetimeSpend:x.lifetimeSpendUSD,lifetimeOrders:total,f:F,r:R});
 if(!result.verified)return unknown(result.reason);
 return {tier:result.grade,status:"verified",reason:"lifetime_spend_and_recent_purchase",M,R,F,
  policyVersion:POLICY_VERSION,basis:BASIS};
}
function aovGroup(value,{verified=false}={}){
 if(!verified||!Number.isFinite(value)||value<0)return null;
 return value>=400?"高客单价":"低客单价";
}
module.exports={grade,aovGroup,TIERS,dayOf,daysBetween};
