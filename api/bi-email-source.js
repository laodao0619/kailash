"use strict";
const {authorized}=require('../lib/kbi-board');
const {tenantToken,request}=require('../lib/crm-feishu');
const SOURCE='https://ycnic6l8vkfx.feishu.cn/wiki/E9U3wgHj6iRIQqksKXxcSEBtn7d?table=tblfmFKLU5ihM532&view=vewgDsfDhw';
module.exports=async(req,res)=>{
 res.setHeader('Cache-Control','private, no-store');
 if(!authorized(req))return res.status(401).json({ok:false,error:'unauthorized'});
 if(req.method!=='GET')return res.status(405).json({ok:false,error:'method'});
 try{
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
 }catch(_){return res.status(503).json({ok:false,error:'feishu_email_schedule_unavailable',source:SOURCE});}
};
