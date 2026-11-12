'use strict';
const {dateRange}=require('./kbi-ops-analytics');
const TIME_ZONE='Etc/GMT+5'; // Explicit fixed EST per task; not EDT.
const money=n=>Math.round((n+Number.EPSILON)*100)/100;
function numeric(x){const v=Number(x);if(x===null||x===undefined||x===''||!Number.isFinite(v)||v<0)throw Error('invalid_ads_number');return v;}
function reportRange(range,now=new Date()){
 if(range)return dateRange(range.start,range.end);
 const end=new Intl.DateTimeFormat('en-CA',{timeZone:TIME_ZONE,year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
 const start=new Date(end+'T12:00:00Z');start.setUTCDate(start.getUTCDate()-29);
 return {start:start.toISOString().slice(0,10),end};
}
function alignedTimezone(tz,range){
 try{for(let t=Date.parse(range.start+'T12:00:00Z');t<=Date.parse(range.end+'T12:00:00Z');t+=86400000){
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:tz,timeZoneName:'longOffset'}).formatToParts(new Date(t));
  if(parts.find(x=>x.type==='timeZoneName')?.value!=='GMT-05:00')return false;
 }return true;}catch{return false;}
}
function summarize(rows){
 const total={spend:0,impressions:0,clicks:0,purchases:0,revenue:0,addToCart:0,checkout:0};
 for(const row of rows)for(const k of Object.keys(total))total[k]+=numeric(row[k]??0);
 total.spend=money(total.spend);total.revenue=money(total.revenue);
 return {...total,roas:total.spend?total.revenue/total.spend:null,cpa:total.purchases?total.spend/total.purchases:null};
}
function safeError(e){return /^[a-z0-9_:.-]{1,120}$/.test(e?.message||'')?e.message:'ads_provider_error';}
function empty(source,status,error,range){return {source,status,error,stale:false,generatedAt:null,lastSuccessfulAt:null,range,timeZone:TIME_ZONE,spend:null,purchases:null,revenue:null,roas:null,cpa:null,daily:[]};}
function namingEvidence(name=''){
 return {rawName:name,testPoints:[['ritual','/ritual|仪式|复线.*ritual/i'],['product_followup','/产品复线|product[ _-]*(follow|retarget|line)/i'],['108_style_braided','/108.*(style|编织|braid)|(style|编织|braid).*108/i']].filter(([,r])=>{const end=r.lastIndexOf('/');return new RegExp(r.slice(1,end),r.slice(end+1)).test(name)}).map(([id])=>id),
 namedDates:[...name.matchAll(/\b20\d{2}[-/.]\d{1,2}[-/.]\d{1,2}\b/g)].map(x=>x[0]),namedLandingPages:name.match(/https?:\/\/[^\s|<>]+/g)||[]};
}
module.exports={TIME_ZONE,money,numeric,reportRange,alignedTimezone,summarize,safeError,empty,namingEvidence};
