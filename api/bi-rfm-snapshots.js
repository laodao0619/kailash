"use strict";
const crypto=require("node:crypto");
const {get,put,list}=require("@vercel/blob");
const ROOT="kbi-rfm-snapshots/v1/";
function auth(req){
 const k=String(process.env.KBI_ACCESS_TOKEN||""),g=String(req.headers?.authorization||"").replace(/^Bearer\s+/i,"");
 return k.length>=24&&!!g&&crypto.timingSafeEqual(crypto.createHash("sha256").update(k).digest(),crypto.createHash("sha256").update(g).digest());
}
function safeId(v){return /^[a-zA-Z0-9_-]{8,60}$/.test(String(v||""));}
async function read(path){
 const r=await get(path,{access:"private"});
 if(!r||r.statusCode!==200)return null;
 const out=[];for await(const chunk of r.stream)out.push(chunk);
 return JSON.parse(Buffer.concat(out).toString("utf8"));
}
module.exports=async(req,res)=>{
 res.setHeader("Cache-Control","private, no-store");
 if(!auth(req))return res.status(401).json({ok:false,error:"unauthorized"});
 try{
  if(req.method==="GET"){
   const id=String(req.query?.id||"");
   if(id){
    if(!safeId(id))return res.status(400).json({ok:false,error:"invalid_snapshot_id"});
    const value=await read(ROOT+id+".json");
    return value?res.status(200).json({ok:true,snapshot:value}):res.status(404).json({ok:false,error:"not_found"});
   }
   const all=await list({prefix:ROOT,limit:100,access:"private"});
   const values=await Promise.all((all.blobs||[]).slice(0,50).map(async x=>read(x.pathname).catch(()=>null)));
   return res.status(200).json({ok:true,snapshots:values.filter(Boolean).map(v=>({
    id:v.id,label:v.label,at:v.at,totalSelected:v.summary.totalSelected,
    classified:v.summary.classified,healthRate:v.summary.health.rate,
    scope:v.summary.scope,sourceAsOf:v.sourceAsOf
   })).sort((a,b)=>b.at.localeCompare(a.at)),more:!!all.hasMore});
  }
  if(req.method!=="POST")return res.status(405).json({ok:false,error:"method"});
  const b=typeof req.body==="string"?JSON.parse(req.body):req.body||{};
  const id=String(b.id||"");
  if(!safeId(id)||typeof b.label!=="string"||!b.label.trim()||b.label.length>80)
   return res.status(400).json({ok:false,error:"invalid_snapshot"});
  if(await read(ROOT+id+".json"))return res.status(409).json({ok:false,error:"snapshot_exists"});
  const {snapshot}=require("./bi-customers-v2");
  const {group}=require("../lib/kbi-rfm-cube");
  const data=await snapshot();
  // Save exactly the underlying CRM source version the analyst is viewing.
  if(!b.sourceAsOf||b.sourceAsOf!==data.generatedAt)
   return res.status(409).json({ok:false,error:"stale_source_refresh_required"});
  const src=b.scope||{};
  const filters={tier:String(src.tier||""),aov:String(src.aov||"all"),
   recencyDays:Number(src.thresholds?.recencyDays||90),
   frequencyOrders:Number(src.thresholds?.frequencyOrders||2),
   monetaryUsd:Number(src.thresholds?.monetaryUsd??800)};
  if(!["all","high","low","unknown"].includes(filters.aov))return res.status(400).json({ok:false,error:"invalid_scope"});
  const value={version:1,id,label:b.label.trim(),at:new Date().toISOString(),
   sourceAsOf:data.generatedAt,summary:group(data.customers,filters)};
  await put(ROOT+id+".json",JSON.stringify(value),{access:"private",allowOverwrite:false,addRandomSuffix:false,contentType:"application/json"});
  return res.status(201).json({ok:true,snapshot:{id:value.id,label:value.label,at:value.at,summary:value.summary}});
 }catch(e){console.error("[rfm-snapshot]",String(e.message||e).slice(0,120));
  return res.status(503).json({ok:false,error:"rfm_snapshot_unavailable"});}
};
