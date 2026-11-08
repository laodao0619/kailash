"use strict";
const crypto=require("node:crypto");
const {get,put}=require("@vercel/blob");
const {snapshot}=require("./bi-customers-v2");
const {matches,normalizeCriteria}=require("../lib/kbi-audience");
const PATH="kbi-operations/v1/audiences.json";
function auth(req){
 const s=String(process.env.KBI_ACCESS_TOKEN||""),g=String(req.headers?.authorization||"").replace(/^Bearer\s+/i,"");
 return s.length>=24&&!!g&&crypto.timingSafeEqual(crypto.createHash("sha256").update(s).digest(),crypto.createHash("sha256").update(g).digest());
}
async function read(){
 const r=await get(PATH,{access:"private"});if(!r||r.statusCode===404)return {version:0,audiences:[]};
 if(r.statusCode!==200)throw Error("audiences_read_failed");
 const chunks=[];for await(const c of r.stream)chunks.push(c);
 return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
async function write(d){await put(PATH,JSON.stringify(d),{access:"private",allowOverwrite:true,addRandomSuffix:false,contentType:"application/json"});}
const validId=s=>/^aud-[a-z0-9_-]{7,44}$/.test(String(s||""));
module.exports=async(req,res)=>{
 res.setHeader("Cache-Control","private, no-store");
 if(!auth(req))return res.status(401).json({ok:false,error:"unauthorized"});
 if(!["GET","POST"].includes(req.method))return res.status(405).json({ok:false,error:"method"});
 try{
  const current=await read();
  if(req.method==="GET"&&!req.query?.preview)return res.status(200).json({ok:true,...current});
  if(req.method==="GET"&&req.query?.preview){
   const data=await snapshot();
   const filters={tier:req.query.tier||"",rfm:req.query.rfm||"",aov:req.query.aov||"all",
    country:req.query.country||"",minM:req.query.minM,maxR:req.query.maxR,
    r:req.query.r||90,f:req.query.f||2,m:req.query.m||800};
   const outcome=matches(data.customers,filters);
   return res.status(200).json({ok:true,counts:outcome.counts,criteria:outcome.criteria,
    sourceAsOf:data.generatedAt,scope:"subscribed_valid_customers_only"});
  }
  const b=typeof req.body==="string"?JSON.parse(req.body):req.body||{};
  if(!Number.isInteger(b.expectedVersion)||b.expectedVersion!==current.version)
   return res.status(409).json({ok:false,error:"audiences_version_changed",version:current.version});
  if(b.action==="delete"){
   if(!validId(b.id)||!current.audiences.some(a=>a.id===b.id))return res.status(404).json({ok:false,error:"audience_not_found"});
   // Deleting local plan does not delete Shopify segments or remove customer tags.
   current.audiences=current.audiences.filter(a=>a.id!==b.id);
  }else if(b.action==="create"){
   if(!validId(b.id)||typeof b.name!=="string"||b.name.trim().length<2||b.name.length>100||
    current.audiences.some(a=>a.id===b.id)||current.audiences.length>=150)
    return res.status(400).json({ok:false,error:"invalid_audience"});
   const criteria=normalizeCriteria(b.criteria);
   const data=await snapshot();
   if(b.sourceAsOf!==data.generatedAt)return res.status(409).json({ok:false,error:"audience_preview_stale"});
   const summary=matches(data.customers,criteria);
   current.audiences.push({id:b.id,name:b.name.trim(),criteria,
    createdAt:new Date().toISOString(),sourceAsOf:data.generatedAt,
    previewCount:summary.counts.matched,kind:"saved_dynamic_filters",
    shopifySync:{status:"not_started",membersTagged:0}});
  }else return res.status(400).json({ok:false,error:"invalid_action"});
  current.version++;
  await write(current);
  return res.status(200).json({ok:true,...current});
 }catch(e){
  if(/invalid_audience_filters/.test(e.message))return res.status(400).json({ok:false,error:"invalid_audience_filters"});
  console.error("BI_AUDIENCES",String(e.message||e).slice(0,95));
  return res.status(503).json({ok:false,error:"audiences_storage_unavailable"});
 }
};
module.exports.read=read;
module.exports.write=write;
