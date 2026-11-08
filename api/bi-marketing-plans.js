"use strict";
const crypto=require("node:crypto");
const {get,put}=require("@vercel/blob");
const PATH="kbi-operations/v1/email-calendar.json";
function auth(req){
 const x=String(process.env.KBI_ACCESS_TOKEN||""),y=String(req.headers?.authorization||"").replace(/^Bearer\s+/i,"");
 return x.length>=24&&!!y&&crypto.timingSafeEqual(crypto.createHash("sha256").update(x).digest(),crypto.createHash("sha256").update(y).digest());
}
async function getData(){
 const r=await get(PATH,{access:"private"});
 if(!r||r.statusCode===404)return {version:0,plans:[]};
 if(r.statusCode!==200)throw Error("calendar_storage_unavailable");
 const chunks=[];for await(const c of r.stream)chunks.push(c);
 return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
async function save(d){
 await put(PATH,JSON.stringify(d),{access:"private",allowOverwrite:true,addRandomSuffix:false,contentType:"application/json"});
}
function validPlan(x){
 return x&&/^plan-[a-z0-9_-]{6,36}$/.test(x.id)&&
 typeof x.title==="string"&&x.title.trim().length>=2&&x.title.length<=120&&
 typeof x.subject==="string"&&x.subject.length<=200&&
 typeof x.preview==="string"&&x.preview.length<=240&&
 typeof x.scheduledAt==="string"&&!Number.isNaN(Date.parse(x.scheduledAt))&&
 ["draft","planned","ready","sent","cancelled"].includes(x.status)&&
 typeof x.audienceId==="string"&&x.audienceId.length<=80&&
 typeof x.utmCampaign==="string"&&/^[a-zA-Z0-9_-]{0,90}$/.test(x.utmCampaign)&&
 typeof x.notes==="string"&&x.notes.length<=2000;
}
module.exports=async(req,res)=>{
 res.setHeader("Cache-Control","private, no-store");
 if(!auth(req))return res.status(401).json({ok:false,error:"unauthorized"});
 if(!["GET","POST"].includes(req.method))return res.status(405).json({ok:false,error:"method"});
 try{
  const data=await getData();
  if(req.method==="GET")return res.status(200).json({ok:true,...data,
   note:"Planning data only. No email is sent automatically."});
  const b=typeof req.body==="string"?JSON.parse(req.body):req.body||{};
  if(!Number.isInteger(b.expectedVersion)||b.expectedVersion!==data.version)
   return res.status(409).json({ok:false,error:"calendar_version_changed",version:data.version});
  if(b.action==="delete"){
   if(!data.plans.some(p=>p.id===b.id))return res.status(404).json({ok:false,error:"plan_not_found"});
   data.plans=data.plans.filter(p=>p.id!==b.id);
  }else if(b.action==="save"){
   if(!validPlan(b.plan))return res.status(400).json({ok:false,error:"invalid_plan"});
   const index=data.plans.findIndex(p=>p.id===b.plan.id);
   const plan={...b.plan,title:b.plan.title.trim(),updatedAt:new Date().toISOString(),
    createdAt:index>=0?data.plans[index].createdAt:new Date().toISOString()};
   if(index>=0)data.plans[index]=plan;
   else{if(data.plans.length>=300)return res.status(413).json({ok:false,error:"calendar_limit"});data.plans.push(plan);}
  }else return res.status(400).json({ok:false,error:"invalid_action"});
  data.version++;data.updatedAt=new Date().toISOString();
  await save(data);
  return res.status(200).json({ok:true,...data});
 }catch(e){console.error("KBI_CALENDAR",String(e.message||e).slice(0,80));
  return res.status(503).json({ok:false,error:"calendar_storage_unavailable"});}
};
module.exports.validPlan=validPlan;
