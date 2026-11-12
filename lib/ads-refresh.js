'use strict';
const {get,put}=require('@vercel/blob');
const {fetchMeta}=require('./meta-ads');const {fetchGoogle}=require('./google-ads');
const {reportRange,empty,safeError,TIME_ZONE,money}=require('./ads-common');
const SOURCES={meta:'Meta Marketing API',google:'Google Ads API'};
async function readProvider(path){const r=await get(path,{access:'private',useCache:false});if(!r||r.statusCode!==200)return null;const chunks=[];for await(const c of r.stream)chunks.push(c);return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
async function writeProvider(path,value){await put(path,JSON.stringify(value),{access:'private',allowOverwrite:true,addRandomSuffix:false,contentType:'application/json'});}
async function refreshAds(input,{force=false,now=new Date(),read=readProvider,write=writeProvider,providers={meta:fetchMeta,google:fetchGoogle}}={}){
 const range=reportRange(input,now),key=range.start+'_'+range.end;
 async function one(name){
  const path='kbi-operations/v3/ads/'+name+'/'+key+'.json';let old=null;
  try{old=await read(path);}catch{}
  if(!force&&old?.status==='ready'&&!old.stale&&Date.parse(old.generatedAt)>now.getTime()-30*60000)return {...old,cached:true};
  // Prevent missing/denied credentials from being hammered by every dashboard open.
  if(!force&&old?.retryAfter&&Date.parse(old.retryAfter)>now.getTime())return {...old,cached:true};
  try{
   const signal=AbortSignal.timeout(45000);
   const fresh=await providers[name](range,{signal});
   if(fresh.status!=='ready'||fresh.range?.start!==range.start||fresh.range?.end!==range.end)throw Error('ads_report_scope_mismatch');
   await write(path,fresh);return {...fresh,cached:false};
  }catch(e){
   const error=safeError(e),at=now.toISOString();
   const status=/approval_pending/.test(error)?'api_application_pending':/credentials_missing|version_required|unconfirmed/.test(error)?'configuration_required':/timezone_mismatch/.test(error)?'timezone_mismatch':'error';
   const last=old?.lastSuccessfulAt||old?.generatedAt;
   const failed=last?{...old,status:'stale',stale:true,error,lastSuccessfulAt:last,attemptedAt:at,retryAfter:new Date(now.getTime()+30*60000).toISOString()}:
    {...empty(SOURCES[name],status,error,range),attemptedAt:at,retryAfter:new Date(now.getTime()+30*60000).toISOString()};
   try{await write(path,failed);}catch{failed.cacheWriteFailed=true;}
   return failed;
  }
 }
 const [meta,google]=await Promise.all([one('meta'),one('google')]);
 const complete=[meta,google].every(x=>x.status==='ready'&&!x.stale&&x.currency==='USD');
 const totalSpend=complete?money(meta.spend+google.spend):null,totalRevenue=complete?money(meta.revenue+google.revenue):null;
 return {meta,google,totalSpend,totalRevenue,blendedRoas:totalSpend>0?totalRevenue/totalSpend:null,complete,timeZone:TIME_ZONE,range,generatedAt:now.toISOString(),sources:SOURCES,
  attributionWarning:'合计为平台各自归因收入相加，可能重复归因同一订单；不是去重收入，也不是Shopify MER。',provisional:range.end>=reportRange(null,now).end};
}
module.exports={refreshAds,readProvider,writeProvider};
