"use strict";
const crypto=require('node:crypto');
const {get,put}=require('@vercel/blob');
const source=require('../lib/crm-report-sources');
const {csv}=require('../lib/crm-period-report');
const PATH='crm-period-reports/v2/current.json';
function match(a,b){return String(b||'').length>=24&&!!a&&crypto.timingSafeEqual(crypto.createHash('sha256').update(a).digest(),crypto.createHash('sha256').update(b).digest());}
async function read(path){const r=await get(path,{access:'private',useCache:false});if(!r||r.statusCode===404)return null;if(r.statusCode!==200)throw Error('report_storage_unavailable');const chunks=[];for await(const c of r.stream)chunks.push(c);return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
async function write(path,data){await put(path,JSON.stringify(data),{access:'private',allowOverwrite:true,addRandomSuffix:false,contentType:'application/json'});}
let inflight=null;
async function update(){if(!inflight)inflight=(async()=>{const d=await source.refresh();await write(PATH,d);return d;})().finally(()=>{inflight=null});return inflight;}
module.exports=async(req,res)=>{
 res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');
 const a=String(req.headers?.authorization||'').replace(/^Bearer\s+/i,'');
 const cron=match(a,process.env.CRON_SECRET),user=match(a,process.env.KBI_ACCESS_TOKEN);
 if(!cron&&!user)return res.status(401).json({ok:false,error:'unauthorized'});
 if(req.method!=='GET')return res.status(405).json({ok:false,error:'method'});
 try{
  let data=await read(PATH);
  if(data?.version!==2||data?.metricPolicyVersion!=='crm-edm-totals-uv-v1')data=null;
  let stale=!!data&&Date.now()-Date.parse(data.generatedAt)>26*3600000;
  if(cron||!data||req.query?.refresh==='1'){data=await update();stale=false;}
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
