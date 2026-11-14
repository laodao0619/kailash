"use strict";
// Audited ledger adapter. M is behavioural 180-day spend; L is lifetime USD.
const {classify,TIERS,POLICY_VERSION,BASIS}=require("./crm-tier-policy");
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
 if(!Number.isFinite(x.lifetimeSpendUSD)||x.lifetimeSpendUSD<0||M>x.lifetimeSpendUSD)return unknown("invalid_lifetime_spend");
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
 if(R>180&&M!==0)return unknown("dormant_nonzero_recent_spend");
 const result=classify({lifetimeSpendUSD:x.lifetimeSpendUSD,f180:F,ordersLifetime:total});
 if(!result.verified)return unknown(result.reason);
 return {...result,status:"verified",reason:"lifetime_spend_and_recent_orders",M,R,F,L:x.lifetimeSpendUSD};
}
function aovGroup(value,{verified=false}={}){
 if(!verified||!Number.isFinite(value)||value<0)return null;
 return value>=400?"高客单价":"低客单价";
}
module.exports={grade,aovGroup,TIERS,dayOf,daysBetween};
