"use strict";
const crypto=require("node:crypto");
const {get,put}=require("@vercel/blob");
const listHandler=require("./bi-customers-v2");
const journeyHandler=require("./bi-journey");
const noteHandler=require("./bi-customer-note");
const INDEX="kbi-index/v2/current.json";
const RESULT="kbi-index/v2/production-qa.json";
function authorized(req){
 const expected=String(process.env.CRON_SECRET||"");
 const actual=String(req.headers?.authorization||"").replace(/^Bearer\s+/i,"");
 if(!expected||!actual)return false;
 return crypto.timingSafeEqual(crypto.createHash("sha256").update(expected).digest(),crypto.createHash("sha256").update(actual).digest());
}
function internalRes(){
 return {code:200,data:null,setHeader(){},status(v){this.code=v;return this;},json(v){this.data=v;return this;}};
}
async function call(handler,query){
 const out=internalRes();
 await handler({method:"GET",query,headers:{authorization:"Bearer "+process.env.KBI_ACCESS_TOKEN}},out);
 return out;
}
async function indexed(){
 const r=await get(INDEX,{access:"private"});
 return !!(r&&r.statusCode===200);
}
async function save(report){
 await put(RESULT,JSON.stringify(report),{access:"private",allowOverwrite:true,addRandomSuffix:false,contentType:"application/json"});
}
function sorted(rows,key,direction){
 let previous=null;
 for(const row of rows){
  const val=row[key];
  if(typeof val!=="number")continue;
  if(previous!==null&&((direction==="desc"&&val>previous)||(direction==="asc"&&val<previous)))return false;
  previous=val;
 }
 return true;
}
module.exports=async(req,res)=>{
 res.setHeader("Cache-Control","no-store");
 if(req.method!=="GET")return res.status(405).json({ok:false,error:"method"});
 if(!authorized(req))return res.status(401).json({ok:false,error:"unauthorized"});
 if(!process.env.KBI_ACCESS_TOKEN)return res.status(503).json({ok:false,error:"login_not_configured"});
 const report={version:2,at:new Date().toISOString(),ready:false,checks:{},metrics:{}};
 try{
  if(!await indexed())return res.status(200).json({ok:true,skipped:"customer_index_still_building"});
  const prior=await get(RESULT,{access:"private"});
  if(prior?.statusCode===200){
   const chunks=[];for await(const c of prior.stream)chunks.push(c);
   const previous=JSON.parse(Buffer.concat(chunks).toString("utf8"));
   if(previous.version===2&&previous.ready&&Date.now()-Date.parse(previous.at)<4*3600000)
    return res.status(200).json({ok:true,skipped:"verified_recently",at:previous.at});
  }
  const first=await call(listHandler,{page:"1",size:"25",sort:"m180",dir:"desc"});
  report.checks.list=first.code===200&&first.data?.ok===true&&first.data?.masterTotal>1000;
  if(!report.checks.list)throw Error("list_not_ready");
  const d=first.data;
  report.metrics.total=d.masterTotal;report.metrics.pageCount=d.pageCount;
  report.metrics.firstPageCount=d.customers.length;
  report.checks.sort=sorted(d.customers,"m180","desc");
  const filtered=await call(listHandler,{page:"1",size:"50",tier:"S+"});
  report.checks.tier=filtered.code===200&&filtered.data?.ok&&
   filtered.data.customers.every(row=>row.tier==="S+");
  const sample=d.customers.find(c=>c.email&&c.id&&c.ordersLifetime>0);
  if(sample){
   const searched=await call(listHandler,{q:sample.email,size:"25"});
   report.checks.search=searched.code===200&&searched.data?.customers?.some(c=>c.id===sample.id);
   const profile=await call(journeyHandler,{id:sample.id});
   report.checks.customer360=profile.code===200&&profile.data?.ok&&
    profile.data.customer?.id==="gid://shopify/Customer/"+sample.id&&Array.isArray(profile.data.events);
   report.metrics.timelineEvents=report.checks.customer360?profile.data.events.length:null;
   report.metrics.mailCoverage=report.checks.customer360?profile.data.coverage?.email||"unknown":null;
   report.checks.productHistory=report.checks.customer360&&
    Array.isArray(profile.data.profile?.products)&&
    Array.isArray(profile.data.profile?.productInterests)&&
    Array.isArray(profile.data.profile?.productSummary);
   report.checks.mailSummary=report.checks.customer360&&
    typeof profile.data.mailSummary?.messages==="number"&&
    Array.isArray(profile.data.mailSummary?.conversations);
   const note=await call(noteHandler,{id:sample.id});
   report.checks.noteRead=note.code===200&&note.data?.ok===true&&
    typeof note.data.text==="string"&&Number.isSafeInteger(note.data.version);
  }else{
   report.checks.search=false;report.checks.customer360=false;
   report.checks.productHistory=false;report.checks.mailSummary=false;report.checks.noteRead=false;
  }
  report.ready=Object.values(report.checks).every(Boolean);
  await save(report);
  return res.status(200).json({ok:true,ready:report.ready,checks:report.checks,
   metrics:report.metrics,note:"Only aggregate QA results; no customer PII exposed."});
 }catch(e){
  report.failure=String(e.message||e).slice(0,80);
  try{await save(report)}catch(_){}
  return res.status(200).json({ok:true,ready:false,checks:report.checks,error:report.failure});
 }
};
module.exports.sorted=sorted;
