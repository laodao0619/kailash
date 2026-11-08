"use strict";
const crypto=require("node:crypto");
const {snapshot}=require("./bi-customers-v2");
const {group}=require("../lib/kbi-rfm-cube");
function auth(req){
 const k=String(process.env.KBI_ACCESS_TOKEN||"");
 const g=String(req.headers?.authorization||"").replace(/^Bearer\s+/i,"");
 return k.length>=24&&!!g&&crypto.timingSafeEqual(crypto.createHash("sha256").update(k).digest(),crypto.createHash("sha256").update(g).digest());
}
module.exports=async(req,res)=>{
 res.setHeader("Cache-Control","private, no-store");
 if(req.method!=="GET")return res.status(405).json({ok:false,error:"method"});
 if(!auth(req))return res.status(401).json({ok:false,error:"unauthorized"});
 try{
  const data=await snapshot();
  const p=req.query||{};
  const filters={tier:String(p.tier||""),aov:String(p.aov||"all"),
   recencyDays:p.r?Number(p.r):90,frequencyOrders:p.f?Number(p.f):2,
   monetaryUsd:p.m?Number(p.m):800};
  if(!["all","high","low","unknown"].includes(filters.aov)||String(filters.tier).length>30)
   return res.status(400).json({ok:false,error:"invalid_filter"});
  const result=group(data.customers,filters);
  return res.status(200).json({ok:true,...result,asOf:data.generatedAt,indexTotal:data.total});
 }catch(e){
  if(e.message==="bad_rfm_thresholds")return res.status(400).json({ok:false,error:e.message});
  return res.status(503).json({ok:false,error:"rfm_snapshot_unavailable"});
 }
};
