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
  // A last-purchase age is evidence of an order even if the order-count
  // snapshot says zero. Do not certify an internally contradictory record.
  if(lifetimeSpend!==0||f!==0||r!=null)return pending("inconsistent_never_purchased");
  return {grade:"从未购买",verified:true};
 }
 // Order history with exactly zero lifetime net USD is an audit exception,
 // not a verified customer tier or a verified dormant account. A complete
 // refund, currency mismatch or incomplete historical ledger needs review.
 if(lifetimeSpend===0)return pending("orders_with_zero_net_spend");
 if(r!=null&&(!Number.isFinite(r)||r<0||(r>180&&f>0)||(r<=180&&f===0)))
  return pending("activity_mismatch");
 if(f===0)return {grade:"沉睡",verified:true};
 for(const t of TIERS){
  if(t.strictPositive?lifetimeSpend>0:lifetimeSpend>=t.minLifetimeSpend)
   return {grade:t.tier,verified:true};
 }
 return {grade:"基础客户",verified:true};
}
function applyRow(row){
 const result=classify({lifetimeSpend:row.spendLifetime,
  lifetimeOrders:row.ordersLifetime,f:row.f180,r:row.rDays});
 return {...row,sourceTier:row.sourceTier??row.tier??null,
  tier:result.grade,tierPolicyVersion:POLICY_VERSION,
  tierBasis:BASIS,tierVerified:false,
  tierStatus:result.verified?"provisional_source_metrics_not_financial_audit":"unverified"};
}
module.exports={classify,applyRow,TIERS,POLICY_VERSION,BASIS};
