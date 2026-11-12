"use strict";
const crypto=require("node:crypto");
const {get,put}=require("@vercel/blob");
const {queryShopify}=require("../lib/crm-shopify");
const {build,queryBatch,dateRange}=require("../lib/kbi-ops-analytics");
const {refreshAds}=require('../lib/ads-refresh');
const PATH="kbi-operations/v1/current.json";
async function read(path=PATH){
 const r=await get(path,{access:"private",useCache:false});
 if(!r||r.statusCode!==200)return null;
 const chunks=[];for await(const c of r.stream)chunks.push(c);
 return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
async function persist(path,result){
 await put(path,JSON.stringify(result),{access:"private",allowOverwrite:true,addRandomSuffix:false,contentType:"application/json"});
}
async function refresh(range,path=PATH,{forceAds=false}={}){
 const previous=await read(path).catch(()=>null);
 // Independent jobs persist their own results before the combined snapshot.
 const adsJob=refreshAds(range,{force:forceAds});
 const shopifyJob=(async()=>{
  let timer;
  try{
   const payload=await Promise.race([queryShopify(queryBatch(range)),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('shopify_timeout')),45000);})]);
   const result=build(payload);
   if(range){result.period="custom";result.range=range;}
   if(previous?.ads)result.ads=previous.ads;
   await persist(path,result);return result;
  }finally{clearTimeout(timer);}
 })();
 const [shopify,ads]=await Promise.allSettled([shopifyJob,adsJob]);
 const result=shopify.status==='fulfilled'?shopify.value:previous;
 if(!result)throw Error('shopify_analytics_unavailable');
 if(shopify.status==='rejected')result.shopifyStale=true;
 if(ads.status==='fulfilled')result.ads=ads.value;
 else result.adsRefreshFailed=true;
 await persist(path,result);return result;
}
function secretMatch(given,expected){
 if(String(expected||"").length<24||!given)return false;
 return crypto.timingSafeEqual(crypto.createHash("sha256").update(expected).digest(),
 crypto.createHash("sha256").update(given).digest());
}
module.exports=async(req,res)=>{
 res.setHeader("Cache-Control","private, no-store");
 if(req.method!=="GET")return res.status(405).json({ok:false,error:"method"});
 const access=String(req.headers?.authorization||"").replace(/^Bearer\s+/i,"");
 const isCron=secretMatch(access,process.env.CRON_SECRET);
 const isUser=secretMatch(access,process.env.KBI_ACCESS_TOKEN);
 if(!isCron&&!isUser)return res.status(401).json({ok:false,error:"unauthorized"});
 let range,path=PATH;
 try{
  if(req.query?.start||req.query?.end){range=dateRange(req.query.start,req.query.end);path="kbi-operations/v2/ranges/"+range.start+"_"+range.end+".json";}
 }catch(_){return res.status(400).json({ok:false,error:"invalid_date_range"});}
 try{
  const existing=await read(path);
  const age=existing?.generatedAt?Date.now()-Date.parse(existing.generatedAt):Infinity;
  // Cron precomputes private analytics; dashboard may cold-boot once.
  if(isCron||!existing||age>2*3600000||req.query?.refresh==="1"){
   const data=await refresh(range,path,{forceAds:req.query?.refresh==="1"});
   return res.status(200).json({ok:true,cached:false,stale:!!data.shopifyStale,data:isCron?{
    version:data.version,generatedAt:data.generatedAt,orders:data.metrics.orders,ads:{meta:data.ads?.meta?.status,google:data.ads?.google?.status}
   }:data});
  }
  // Provider caches have a separate 30-minute TTL; reading the dashboard does
  // not force a fresh Insights query while Shopify keeps its existing 2h TTL.
  existing.ads=await refreshAds(range);
  return res.status(200).json({ok:true,cached:true,stale:!!existing.shopifyStale||age>2*3600000,data:existing});
 }catch(e){
  console.error("BI_OPS_REPORT",String(e.message||e).slice(0,95));
  const fallback=await read(path).catch(()=>null);
  if(fallback)return res.status(200).json({ok:true,cached:true,stale:true,data:fallback,warning:"refresh_failed_using_last_good"});
  return res.status(503).json({ok:false,error:"shopify_analytics_unavailable"});
 }
};
module.exports.refresh=refresh;
module.exports.read=read;
