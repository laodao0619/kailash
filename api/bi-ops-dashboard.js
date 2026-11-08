"use strict";
const crypto=require("node:crypto");
const {get,put}=require("@vercel/blob");
const {queryShopify}=require("../lib/crm-shopify");
const {build,queryBatch}=require("../lib/kbi-ops-analytics");
const PATH="kbi-operations/v1/current.json";
async function read(){
 const r=await get(PATH,{access:"private"});
 if(!r||r.statusCode!==200)return null;
 const chunks=[];for await(const c of r.stream)chunks.push(c);
 return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
async function refresh(){
 const payload=await queryShopify(queryBatch());
 const result=build(payload);
 await put(PATH,JSON.stringify(result),{access:"private",allowOverwrite:true,addRandomSuffix:false,contentType:"application/json"});
 return result;
}
function secretMatch(given,expected){
 if(String(expected||"").length<24||!given)return false;
 return crypto.timingSafeEqual(crypto.createHash("sha256").update(expected).digest(),
 crypto.createHash("sha256").update(given).digest());
}
module.exports=async(req,res)=>{
 res.setHeader("Cache-Control","private, no-store");
 if(req.method!=="GET")return res.status(405).json({ok:false,error:"method"});
 const access=String(req.headers?.authorization||"").replace(/^Bearer\\s+/i,"");
 const isCron=secretMatch(access,process.env.CRON_SECRET);
 const isUser=secretMatch(access,process.env.KBI_ACCESS_TOKEN);
 if(!isCron&&!isUser)return res.status(401).json({ok:false,error:"unauthorized"});
 try{
  const existing=await read();
  const age=existing?.generatedAt?Date.now()-Date.parse(existing.generatedAt):Infinity;
  // Cron precomputes private analytics; dashboard may cold-boot once.
  if(isCron||!existing){
   const data=await refresh();
   return res.status(200).json({ok:true,cached:false,data:isCron?{
    version:data.version,generatedAt:data.generatedAt,orders:data.metrics.orders
   }:data});
  }
  return res.status(200).json({ok:true,cached:true,stale:age>2*3600000,data:existing});
 }catch(e){
  console.error("BI_OPS_REPORT",String(e.message||e).slice(0,95));
  const fallback=await read().catch(()=>null);
  if(fallback)return res.status(200).json({ok:true,cached:true,stale:true,data:fallback,warning:"refresh_failed_using_last_good"});
  return res.status(503).json({ok:false,error:"shopify_analytics_unavailable"});
 }
};
module.exports.refresh=refresh;
module.exports.read=read;
