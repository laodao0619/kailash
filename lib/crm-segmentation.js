"use strict";
// CRM grades and behavioural RFM segments answer different questions.
// Behavioural M/F uses 180 days; value tiers use explicit lifetime spend.
const SEGMENTS=Object.freeze({HHH:"重要价值用户",HHL:"重要保持用户",HLH:"重要发展用户",HLL:"一般发展用户",LHH:"重要挽留用户",LHL:"一般挽留用户",LLH:"一般价值用户",LLL:"一般保持用户"});
function segment({m,r,f},thresholds={recencyDays:90,frequencyOrders:2,monetaryUsd:800}){
 if(![m,r,f].every(Number.isFinite)||m<0||r<0||f<0)return {segment:null,code:null,verified:false,reason:"M/R/F 缺失或未核验"};
 const code=(r<=thresholds.recencyDays?"H":"L")+(f>=thresholds.frequencyOrders?"H":"L")+(m>=thresholds.monetaryUsd?"H":"L");
 return {segment:SEGMENTS[code],code,verified:true};
}
function grade({lifetimeSpendUSD,f,lifetimeOrders}){
 const result=require("./crm-tier-policy").classify({lifetimeSpendUSD,f180:f,ordersLifetime:lifetimeOrders});
 return {...result,grade:result.tier};
}
module.exports={SEGMENTS,segment,grade};
