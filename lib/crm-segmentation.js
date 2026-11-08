"use strict";
// CRM grades and behavioural RFM segments answer different questions.
// Never substitute lifetime spend/total orders for 180-day M/F.
const SEGMENTS=Object.freeze({HHH:"重要价值用户",HHL:"重要保持用户",HLH:"重要发展用户",HLL:"一般发展用户",LHH:"重要挽留用户",LHL:"一般挽留用户",LLH:"一般价值用户",LLL:"一般保持用户"});
function segment({m,r,f},thresholds={recencyDays:90,frequencyOrders:2,monetaryUsd:800}){
 if(![m,r,f].every(Number.isFinite)||m<0||r<0||f<0)return {segment:null,code:null,verified:false,reason:"M/R/F 缺失或未核验"};
 const code=(r<=thresholds.recencyDays?"H":"L")+(f>=thresholds.frequencyOrders?"H":"L")+(m>=thresholds.monetaryUsd?"H":"L");
 return {segment:SEGMENTS[code],code,verified:true};
}
function grade({m,r,f,lifetimeOrders}){
 if(!Number.isFinite(lifetimeOrders)||lifetimeOrders<0)return {grade:"待核验",verified:false};
 if(lifetimeOrders===0)return {grade:"从未购买",verified:true};
 if(![m,r,f].every(Number.isFinite)||m<0||r<0||f<0)return {grade:"待核验",verified:false};
 if(r>180)return {grade:"沉睡",verified:true};
 if(m>=3000&&r<=45&&f>=5)return {grade:"S+",verified:true};
 if(m>=1500&&r<=90&&f>=3)return {grade:"S",verified:true};
 if(m>=800&&r<=180&&f>=2)return {grade:"A",verified:true};
 if(m>0&&r<=180&&f>=1)return {grade:"B",verified:true};
 return {grade:"基础客户",verified:true};
}
module.exports={SEGMENTS,segment,grade};
