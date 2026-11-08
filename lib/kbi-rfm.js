"use strict";
/**
 * Kailash CRM grading policy, effective 2026-11-08.
 * Input figures MUST come from reconciled USD net order ledger, not
 * Shopify lifetime amountSpent or the 2026-10-23 HTML snapshot.
 *
 * M = verified net USD spend in last 180d
 * R = days since latest valid purchase (date precision)
 * F = valid paid orders in last 180d
 * Lifetime purchase proof and complete history are required for dormant/never.
 */
const TIERS=Object.freeze([
 {tier:"S+",minM:3000,maxR:45,minF:5},
 {tier:"S",minM:1500,maxR:90,minF:3},
 {tier:"A",minM:800,maxR:180,minF:2},
 {tier:"B",minM:0,maxR:180,minF:1,strictPositiveM:true}
]);
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
  policyVersion:"2026-11-08",basis:"rolling_180d_net_USD"};
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
 if(!Number.isFinite(M)||M<0||!Number.isInteger(F)||F<0||
    !Number.isInteger(total)||total<0)
  return unknown("invalid_or_missing_metrics");
 if(F>total)return unknown("recent_orders_exceed_lifetime");
 const latest=x.latestValidOrderDate;
 const day=dayOf(latest);
 if(total===0){
  if(F!==0||M!==0||latest)return unknown("never_purchased_inconsistent");
  return {tier:"从未购买",status:"verified",reason:"zero_lifetime_orders",M,R:null,F,
   policyVersion:"2026-11-08",basis:"rolling_180d_net_USD"};
 }
 if(!day||day>asOf)return unknown("invalid_last_purchase");
 const R=daysBetween(day,asOf);
 if((R<=180&&F===0)||(R>180&&F>0))
  return unknown("activity_mismatch");
 if(R>180){
  if(M!==0)return unknown("dormant_nonzero_recent_spend");
  return {tier:"沉睡",status:"verified",reason:"last_purchase_over_180_days",M,R,F,
   policyVersion:"2026-11-08",basis:"rolling_180d_net_USD"};
 }
 for(const t of TIERS){
  const passesMoney=t.strictPositiveM?M>0:M>=t.minM;
  if(passesMoney&&R<=t.maxR&&F>=t.minF)
   return {tier:t.tier,status:"verified",reason:"meets_all_thresholds",M,R,F,
    policyVersion:"2026-11-08",basis:"rolling_180d_net_USD"};
 }
 return {tier:"基础客户",status:"verified",reason:"below_B_requirements",M,R,F,
  policyVersion:"2026-11-08",basis:"rolling_180d_net_USD"};
}
function aovGroup(value,{verified=false}={}){
 if(!verified||!Number.isFinite(value)||value<0)return null;
 return value>=400?"高客单价":"低客单价";
}
module.exports={grade,aovGroup,TIERS,dayOf,daysBetween};
