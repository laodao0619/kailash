"use strict";
const POLICY_VERSION="2026-11-12";
const BASIS="lifetime_spend_with_180d_purchase";
const TIERS=Object.freeze([
 {tier:"S+",minLifetimeSpend:3000},
 {tier:"S",minLifetimeSpend:1500},
 {tier:"A",minLifetimeSpend:800},
 {tier:"B",minLifetimeSpend:0,strictPositive:true}
]);
// Unknown source values never become zero. RFM M remains a separate metric.
function classify({lifetimeSpend,lifetimeOrders,f,r}){
 const pending=reason=>({grade:"待核验",verified:false,reason});
 if(!Number.isInteger(lifetimeOrders)||lifetimeOrders<0||
    !Number.isInteger(f)||f<0||f>lifetimeOrders)
  return pending("invalid_order_counts");
 if(!Number.isFinite(lifetimeSpend)||lifetimeSpend<0)
  return pending("missing_lifetime_spend");
 if(lifetimeOrders===0){
  if(lifetimeSpend!==0||f!==0)return pending("inconsistent_never_purchased");
  return {grade:"从未购买",verified:true};
 }
 // A positive order count with zero lifetime net spend is not a B customer
 // or a dormant customer: the financial ledger needs human reconciliation.
 if(lifetimeSpend===0)return pending("zero_net_spend_with_orders");
 if(r!=null&&(!Number.isFinite(r)||r<0||(r>180&&f>0)||(r<=180&&f===0)))
  return pending("activity_mismatch");
 if(f===0)return {grade:"沉睡",verified:true};
 for(const t of TIERS){
  if(t.strictPositive?lifetimeSpend>0:lifetimeSpend>=t.minLifetimeSpend)
   return {grade:t.tier,verified:true};
 }
 // No extra tier exists below B; unexplained data must fail closed.
 return pending("unclassified_purchase");
}
function applyRow(row){
 const result=classify({lifetimeSpend:row.spendLifetime,
  lifetimeOrders:row.ordersLifetime,f:row.f180,r:row.rDays});
 return {...row,tier:result.grade,tierPolicyVersion:POLICY_VERSION,
  tierBasis:BASIS,tierVerified:result.verified};
}
module.exports={classify,applyRow,TIERS,POLICY_VERSION,BASIS};
