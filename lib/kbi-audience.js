"use strict";
const {segment}=require("./crm-segmentation");
const ALLOWED_TIERS=new Set(["","S+","S","A","B","基础客户","沉睡","从未购买","待核验"]);
const VALID_AOV=new Set(["all","high","low","unknown"]);
function normalizeCriteria(p={}){
 const c={tier:String(p.tier||""),rfm:String(p.rfm||""),aov:String(p.aov||"all"),
  country:String(p.country||"").trim().slice(0,70),
  minM:p.minM===""||p.minM==null?null:Number(p.minM),
  maxR:p.maxR===""||p.maxR==null?null:Number(p.maxR),
  r:Number(p.r||90),f:Number(p.f||2),m:Number(p.m??800),
  consentOnly:true};
 if(!ALLOWED_TIERS.has(c.tier)||!/^(|[HL]{3})$/.test(c.rfm)||!VALID_AOV.has(c.aov)||
  [c.r,c.f,c.m].some(v=>!Number.isFinite(v))||c.r<1||c.r>3650||c.f<1||c.f>200||
  c.m<0||c.m>1e6||(c.minM!==null&&(!Number.isFinite(c.minM)||c.minM<0))||
  (c.maxR!==null&&(!Number.isFinite(c.maxR)||c.maxR<0)))throw Error("invalid_audience_filters");
 return c;
}
function eligible(c){
 const s=String(c.subscription||"").trim().toLowerCase();
 if(/not.?subscribed|unsubscribed|未订阅|取消订阅|未同意|拒绝|pending|待确认|未知/.test(s))return false;
 return s==="subscribed"||s==="已订阅"||s==="订阅"||s==="同意营销"||s==="yes";
}
function matches(rows,params){
 const c=normalizeCriteria(params);
 const matching=[],excluded={consent:0,quality:0,rfm:0};
 for(const x of rows||[]){
  if(!/^\d{5,25}$/.test(String(x.id||""))||!x.email||!/^.+@[^@]+\.[^@]+$/.test(x.email)||
   /@(?:qq\.com|example\.|test\.)/i.test(x.email)||/robot|bot|机器人|垃圾|测试|invalid|无效|重复/.test(String(x.quality||"").toLowerCase())){
   excluded.quality++;continue;
  }
  if(!eligible(x)){excluded.consent++;continue;}
  if(c.tier&&x.tier!==c.tier)continue;
  if(c.country&&x.country!==c.country)continue;
  if(c.aov==="high"&&!(Number.isFinite(x.aov)&&x.aov>=400))continue;
  if(c.aov==="low"&&!(Number.isFinite(x.aov)&&x.aov<400))continue;
  if(c.aov==="unknown"&&Number.isFinite(x.aov))continue;
  if(c.minM!==null&&!(Number.isFinite(x.m180)&&x.m180>=c.minM))continue;
  if(c.maxR!==null&&!(Number.isFinite(x.rDays)&&x.rDays<=c.maxR))continue;
  if(c.rfm){
   const sg=segment({m:x.m180,r:x.rDays,f:x.f180},{recencyDays:c.r,frequencyOrders:c.f,monetaryUsd:c.m});
   if(!sg.verified){excluded.rfm++;continue;}
   if(sg.code!==c.rfm)continue;
  }
  matching.push(x.id);
 }
 return {ids:matching,counts:{matched:matching.length,excluded},criteria:c};
}
module.exports={normalizeCriteria,matches,eligible};
