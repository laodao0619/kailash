"use strict";
// CRM value tiers use lifetime USD spend and rolling 180-day order count.
// Behavioural RFM M remains rolling 180-day spend and never substitutes for L.
const POLICY_VERSION="2026-11-12";
const BASIS="lifetime_USD_and_180d_orders";
const TIERS=Object.freeze([
 {tier:"S+",label:"专属服务客户",minLifetime:3000},
 {tier:"S",label:"重点客户",minLifetime:1500},
 {tier:"A",label:"成长客户",minLifetime:800},
 {tier:"B",label:"基础客户",minLifetime:0}
]);
function classify({lifetimeSpendUSD:l,f180:f,ordersLifetime:total}){
 const fail=reason=>({tier:"待核验",verified:false,reason,policyVersion:POLICY_VERSION,basis:BASIS});
 if(!Number.isFinite(l)||l<0||!Number.isInteger(f)||f<0)return fail("missing_lifetime_spend_or_recent_orders");
 if(total!==undefined&&total!==null&&(!Number.isInteger(total)||total<0||f>total))return fail("inconsistent_order_counts");
 if(total===0){
  if(l!==0||f!==0)return fail("never_purchased_inconsistent");
  return {tier:"从未购买",verified:true,policyVersion:POLICY_VERSION,basis:BASIS};
 }
 // Paid history with zero net spend is outside the positive-spend rubric.
 if(l===0)return fail("zero_lifetime_spend_outside_tiers");
 const tier=f===0?"沉睡":TIERS.find(t=>t.minLifetime===0?l>0:l>=t.minLifetime).tier;
 return {tier,verified:true,policyVersion:POLICY_VERSION,basis:BASIS};
}
function applyRow(row){
 const result=classify({lifetimeSpendUSD:row.spendLifetime,f180:row.f180,ordersLifetime:row.ordersLifetime});
 return {...row,sourceTier:row.sourceTier??row.tier??null,tier:result.tier,
  tierPolicyVersion:POLICY_VERSION,tierBasis:BASIS,tierVerified:false,
  tierStatus:result.verified?"provisional_source_metrics_not_financial_audit":"unverified"};
}
function fieldNumber(v){
 if(Array.isArray(v))v=v.map(x=>typeof x==="object"?x?.text??"":x).join("");
 if(v===null||v===undefined||String(v).trim()==="")return null;
 const n=Number(String(v).replace(/,/g,""));return Number.isFinite(n)?n:null;
}
function fromFields(f){return classify({lifetimeSpendUSD:fieldNumber(f["历史累计消费"]),f180:fieldNumber(f["近180天有效订单数"]),ordersLifetime:fieldNumber(f["历史订单数"])});}
module.exports={classify,applyRow,fromFields,TIERS,POLICY_VERSION,BASIS};
