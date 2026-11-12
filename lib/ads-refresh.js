'use strict';
const {get,put}=require('@vercel/blob');
const {fetchMeta}=require('./meta-ads');const {fetchGoogle}=require('./google-ads');
const {reportRange,empty,safeError,TIME_ZONE,GOOGLE_TIME_ZONE,money}=require('./ads-common');
const SOURCES={meta:'Meta Marketing API',google:'Google Ads API'};
async function readProvider(path){const r=await get(path,{access:'private',useCache:false});if(!r||r.statusCode!==200)return null;const chunks=[];for await(const c of r.stream)chunks.push(c);return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
async function writeProvider(path,value){await put(path,JSON.stringify(value),{access:'private',allowOverwrite:true,addRandomSuffix:false,contentType:'application/json'});}
async function refreshAds(input,{force=false,now=new Date(),read=readProvider,write=writeProvider,providers={meta:fetchMeta,google:fetchGoogle}}={}){
 const range=reportRange(input,now);
 const googleRange=reportRange(input,now,GOOGLE_TIME_ZONE);
 async function one(name){
  const providerRange=name==='google'?googleRange:range,timeZone=name==='google'?GOOGLE_TIME_ZONE:TIME_ZONE;
  const key=providerRange.start+'_'+providerRange.end;
  const path=name==='google'?'kbi-operations/v4/ads/google/gmt-04/'+key+'.json':'kbi-operations/v3/ads/meta/'+key+'.json';let old=null;
  try{old=await read(path);}catch{}
  if(old&&(old.timeZone!==timeZone||old.range?.start!==providerRange.start||old.range?.end!==providerRange.end))old=null;
  if(!force&&old?.status==='ready'&&!old.stale&&Date.parse(old.generatedAt)>now.getTime()-30*60000)return {...old,cached:true};
  // Prevent missing/denied credentials from being hammered by every dashboard open.
  if(!force&&old?.retryAfter&&Date.parse(old.retryAfter)>now.getTime())return {...old,cached:true};
  try{
   const signal=AbortSignal.timeout(45000);
   const fresh=await providers[name](providerRange,{signal});
   if(fresh.status!=='ready'||fresh.range?.start!==providerRange.start||fresh.range?.end!==providerRange.end||fresh.timeZone!==timeZone)throw Error('ads_report_scope_mismatch');
   await write(path,fresh);return {...fresh,cached:false};
  }catch(e){
   const error=safeError(e),at=now.toISOString();
   const status=/approval_pending/.test(error)?'api_application_pending':/credentials_missing|version_required|unconfirmed/.test(error)?'configuration_required':/timezone_mismatch/.test(error)?'timezone_mismatch':'error';
   const last=old?.lastSuccessfulAt||old?.generatedAt;
   const failed=last?{...old,status:'stale',stale:true,error,lastSuccessfulAt:last,attemptedAt:at,retryAfter:new Date(now.getTime()+30*60000).toISOString()}:
    {...empty(SOURCES[name],status,error,providerRange,timeZone),attemptedAt:at,retryAfter:new Date(now.getTime()+30*60000).toISOString()};
   try{await write(path,failed);}catch{failed.cacheWriteFailed=true;}
   return failed;
  }
 }
 const [meta,google]=await Promise.all([one('meta'),one('google')]);
 const comparable=meta.timeZone===google.timeZone&&meta.range?.start===google.range?.start&&meta.range?.end===google.range?.end;
 const complete=comparable&&[meta,google].every(x=>x.status==='ready'&&!x.stale&&x.currency==='USD');
 const totalSpend=complete?money(meta.spend+google.spend):null,totalRevenue=complete?money(meta.revenue+google.revenue):null;
 return {meta,google,totalSpend,totalRevenue,blendedRoas:totalSpend>0?totalRevenue/totalSpend:null,complete,comparable,totalUnavailableReason:comparable?null:'provider_day_boundaries_differ',timeZone:comparable?meta.timeZone:null,range,generatedAt:now.toISOString(),sources:SOURCES,
  attributionWarning:'合计为平台各自归因收入相加，可能重复归因同一订单；不是去重收入，也不是Shopify MER。',provisional:range.end>=reportRange(null,now).end||googleRange.end>=reportRange(null,now,GOOGLE_TIME_ZONE).end};
}
module.exports={refreshAds,readProvider,writeProvider};
