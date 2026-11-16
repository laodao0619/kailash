"use strict";
const crypto=require('node:crypto');
const {get,put}=require('@vercel/blob');
const source=require('../lib/crm-report-sources');
const {csv}=require('../lib/crm-period-report');
const PATH='crm-period-reports/v1/current.json',SPEND='crm-period-reports/v1/manual-spend.json';
function match(a,b){return String(b||'').length>=24&&!!a&&crypto.timingSafeEqual(crypto.createHash('sha256').update(a).digest(),crypto.createHash('sha256').update(b).digest());}
async function read(path){const r=await get(path,{access:'private',useCache:false});if(!r||r.statusCode===404)return null;if(r.statusCode!==200)throw Error('report_storage_unavailable');const chunks=[];for await(const c of r.stream)chunks.push(c);return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
async function write(path,data){await put(path,JSON.stringify(data),{access:'private',allowOverwrite:true,addRandomSuffix:false,contentType:'application/json'});}
let inflight=null;
async function update(){if(!inflight)inflight=(async()=>{const manual=await read(SPEND)||{};const d=await source.refresh(manual);await write(PATH,d);return d;})().finally(()=>{inflight=null});return inflight;}
module.exports=async(req,res)=>{
 res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');
 const a=String(req.headers?.authorization||'').replace(/^Bearer\s+/i,'');
 const cron=match(a,process.env.CRON_SECRET),user=match(a,process.env.KBI_ACCESS_TOKEN);
 if(!cron&&!user)return res.status(401).json({ok:false,error:'unauthorized'});
 if(!['GET','POST'].includes(req.method))return res.status(405).json({ok:false,error:'method'});
 try{
  if(req.method==='POST'){
   if(!user)return res.status(403).json({ok:false,error:'user_required'});
   const b=typeof req.body==='string'?JSON.parse(req.body):req.body||{};
   const current=await read(PATH);
   if(!current||b.currency!==current.currency||![...current.daily,...current.weekly].some(p=>p.start===b.start&&p.end===b.end))return res.status(400).json({ok:false,error:'invalid_spend_period_or_currency'});
   for(const k of ['metaSpend','googleSpend'])if(b[k]!==null&&(!Number.isFinite(b[k])||b[k]<0||b[k]>1e9))return res.status(400).json({ok:false,error:'invalid_spend'});
   // Reject conflicting manual input writes instead of silently losing edits.
   const key=b.start+'_'+b.end;
   const previous=await get(SPEND,{access:'private',useCache:false});
   let manual={};
   if(previous){if(previous.statusCode!==200)throw Error('spend_storage_unavailable');const chunks=[];for await(const c of previous.stream)chunks.push(c);manual=JSON.parse(Buffer.concat(chunks).toString('utf8'));}
   manual[key]={metaSpend:b.metaSpend,googleSpend:b.googleSpend,updatedAt:new Date().toISOString()};
   await put(SPEND,JSON.stringify(manual),{access:'private',allowOverwrite:!!previous,addRandomSuffix:false,contentType:'application/json',...(previous?{ifMatch:previous.blob.etag.replace(/^W\//,'')}:{})});
   const data=await update();return res.status(200).json({ok:true,data});
  }
  let data=await read(PATH),stale=!!data&&Date.now()-Date.parse(data.generatedAt)>26*3600000;
  if(cron||!data||req.query?.refresh==='1')data=await update();
  if(req.query?.format==='csv'){
   const kind=req.query.kind==='weekly'?'weekly':'daily';
   res.setHeader('Content-Type','text/csv; charset=utf-8');res.setHeader('Content-Disposition','attachment; filename="kailash-crm-'+kind+'.csv"');
   return res.status(200).send(csv(data,kind));
  }
  return res.status(200).json({ok:true,stale, data:cron?{generatedAt:data.generatedAt,through:data.through,sourceErrors:data.sourceErrors}:data});
 }catch(e){
  console.error('CRM_PERIOD_REPORT',String(e.message).slice(0,100));
  const data=await read(PATH).catch(()=>null);
  if(req.method==='GET'&&data&&!cron)return res.status(200).json({ok:true,stale:true,warning:'刷新失败，显示上次成功数据',data});
  return res.status(503).json({ok:false,error:'crm_report_refresh_failed'});
 }
};
module.exports.update=update;
