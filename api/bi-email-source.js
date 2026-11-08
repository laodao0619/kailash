"use strict";
const {get,put}=require('@vercel/blob');
const PATH='kbi-operations/v2/feishu-email-source.json';
async function readSnapshot(){const r=await get(PATH,{access:'private',useCache:false});if(!r||r.statusCode!==200)return null;const c=[];for await(const x of r.stream)c.push(x);return JSON.parse(Buffer.concat(c).toString('utf8'));}
const {authorized}=require('../lib/kbi-board');
const {tenantToken,request}=require('../lib/crm-feishu');
const SOURCE='https://ycnic6l8vkfx.feishu.cn/wiki/E9U3wgHj6iRIQqksKXxcSEBtn7d?table=tblfmFKLU5ihM532&view=vewgDsfDhw';
module.exports=async(req,res)=>{
 res.setHeader('Cache-Control','private, no-store');
 if(!authorized(req))return res.status(401).json({ok:false,error:'unauthorized'});
 if(!['GET','POST'].includes(req.method))return res.status(405).json({ok:false,error:'method'});
 try{
  if(req.method==='POST'){
   const b=typeof req.body==='string'?JSON.parse(req.body):req.body;
   if(!b||b.action!=='save_verified_snapshot'||!Array.isArray(b.records)||b.records.length>1000||!Array.isArray(b.fields)||b.fields.length>50||typeof b.readAt!=='string'||Number.isNaN(Date.parse(b.readAt))||JSON.stringify(b).length>500000)return res.status(400).json({ok:false,error:'invalid_snapshot'});
   if(b.fields.some(f=>typeof f.name!=='string'||f.name.length>100)||b.records.some(r=>typeof r.record_id!=='string'||!r.fields||typeof r.fields!=='object'))return res.status(400).json({ok:false,error:'invalid_snapshot'});
   const data={ok:true,source:SOURCE,readAt:b.readAt,fields:b.fields,records:b.records,excludedBlankRows:Number(b.excludedBlankRows)||0,cached:true,sourceMode:'verified_browser_snapshot'};
   await put(PATH,JSON.stringify(data),{access:'private',allowOverwrite:true,addRandomSuffix:false,contentType:'application/json'});
   return res.status(200).json(data);
  }
  const t=await tenantToken();
  const wiki=await request(t,'/wiki/v2/spaces/get_node?token=E9U3wgHj6iRIQqksKXxcSEBtn7d');
  const app=wiki.node?.obj_token;if(!app)throw Error('wiki_node_unavailable');
  const base='/bitable/v1/apps/'+encodeURIComponent(app)+'/tables/tblfmFKLU5ihM532';
  const fields=await request(t,base+'/fields?page_size=100');
  const rows=[];let cursor='';
  for(let page=0;page<10;page++){
   const d=await request(t,base+'/records?page_size=100&view_id=vewgDsfDhw'+(cursor?'&page_token='+encodeURIComponent(cursor):''));
   rows.push(...(d.items||[]));
   if(!d.has_more)return res.status(200).json({ok:true,source:SOURCE,readAt:new Date().toISOString(),fields:(fields.items||[]).map(f=>({name:f.field_name,type:f.type})),records:rows});
   cursor=d.page_token;
  }
  return res.status(200).json({ok:true,source:SOURCE,partial:true,records:rows,fields:fields.items,readAt:new Date().toISOString()});
 }catch(e){console.error('KBI_EMAIL_SOURCE',String(e.message).slice(0,160));const saved=await readSnapshot().catch(()=>null);if(saved)return res.status(200).json({...saved,warning:'live_feishu_read_unavailable'});return res.status(503).json({ok:false,error:'feishu_email_schedule_unavailable',source:SOURCE});}
};
