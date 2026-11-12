"use strict";
const SEGMENTS=require("./crm-segmentation").SEGMENTS;
const ORDER=["HHH","HHL","HLH","HLL","LHH","LHL","LLH","LLL"];
function finite(x){return typeof x==="number"&&Number.isFinite(x);}
function group(rows,{tier="",aov="all",recencyDays=90,frequencyOrders=2,monetaryUsd=800}={}){
 const thresholds={recencyDays:Number(recencyDays),frequencyOrders:Number(frequencyOrders),monetaryUsd:Number(monetaryUsd)};
 if(!Number.isFinite(thresholds.recencyDays)||thresholds.recencyDays<1||thresholds.recencyDays>3650||
 !Number.isFinite(thresholds.frequencyOrders)||thresholds.frequencyOrders<1||thresholds.frequencyOrders>200||
 !Number.isFinite(thresholds.monetaryUsd)||thresholds.monetaryUsd<0||thresholds.monetaryUsd>1000000)throw Error("bad_rfm_thresholds");
 const eligible=(rows||[]).filter(c=>(!tier||c.tier===tier)&&(
 aov==="all"||(aov==="high"&&finite(c.aov)&&c.aov>=400)||
 (aov==="low"&&finite(c.aov)&&c.aov<400)||
 (aov==="unknown"&&!finite(c.aov))
 ));
 const counts=Object.fromEntries(ORDER.map(x=>[x,0]));
 const net=Object.fromEntries(ORDER.map(x=>[x,0]));
 const unknown={count:0,m:0,r:0,f:0};
 const s=require("./crm-segmentation");
 let count=0,monetaryTotal=0;
 for(const c of eligible){
  if(![c.m180,c.rDays,c.f180].every(finite)||c.m180<0||c.rDays<0||c.f180<0){
   unknown.count++;
   if(!finite(c.m180)||c.m180<0)unknown.m++;
   if(!finite(c.rDays)||c.rDays<0)unknown.r++;
   if(!finite(c.f180)||c.f180<0)unknown.f++;
   continue;
  }
  const r=s.segment({m:c.m180,r:c.rDays,f:c.f180},thresholds);
  if(!r.code){unknown.count++;continue;}
  counts[r.code]++;net[r.code]+=c.m180;count++;monetaryTotal+=c.m180;
 }
 const segments=ORDER.map(code=>({code,label:SEGMENTS[code],count:counts[code],
  pct:count?Math.round(counts[code]/count*10000)/100:0,
  m180:Math.round(net[code]*100)/100}));
 const healthyCodes=["HHH","HHL","HLH","HLL"];
 const healthy=healthyCodes.reduce((v,c)=>v+counts[c],0);
 // Proportion of recent (R=H) customers among clients with complete RFM.
 const healthRate=count?Math.round(healthy/count*10000)/100:null;
 return {tierPolicyVersion:require("./crm-tier-policy").POLICY_VERSION,scope:{tier:tier||"all",aov,thresholds},
  totalSelected:eligible.length,classified:count,unknown,health:{definition:"Share of classified customers whose R is high (purchased within threshold)",recentCount:healthy,rate:healthRate,denominator:count},
  monetaryTotal:Math.round(monetaryTotal*100)/100,segments,
  source:"historical_180_day_crm_snapshot",auditStatus:"not_final_full_history_net_ledger"};
}
module.exports={group,ORDER};
