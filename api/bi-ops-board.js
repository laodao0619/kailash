"use strict";
const {get,put}=require('@vercel/blob');
const {authorized,defaults,validItem}=require('../lib/kbi-board');
const PATH='kbi-operations/v2/board.json';
module.exports=async(req,res)=>{
 res.setHeader('Cache-Control','private, no-store');
 if(!authorized(req))return res.status(401).json({ok:false,error:'unauthorized'});
 if(!['GET','POST'].includes(req.method))return res.status(405).json({ok:false,error:'method'});
 try{
  const r=await get(PATH,{access:'private',useCache:false});
  let data=defaults();
  if(r&&r.statusCode!==200)throw Error('storage_unavailable');
  if(r){const chunks=[];for await(const c of r.stream)chunks.push(c);data=JSON.parse(Buffer.concat(chunks).toString('utf8'));}
  if(req.method==='GET')return res.status(200).json({ok:true,...data});
  const b=typeof req.body==='string'?JSON.parse(req.body):req.body||{};
  if(b.expectedVersion!==data.version)return res.status(409).json({ok:false,error:'board_version_changed',version:data.version});
  if(b.action==='save'){
   if(!validItem(b.item))return res.status(400).json({ok:false,error:'invalid_item'});
   const x=b.item;
   const item={id:x.id,kind:x.kind,title:x.title.trim(),notes:x.notes,done:x.done,priority:x.priority,updatedAt:new Date().toISOString()};
   const index=data.items.findIndex(i=>i.id===item.id);
   if(index>=0)data.items[index]=item;
   else{if(data.items.length>=300)return res.status(413).json({ok:false,error:'board_limit'});data.items.push(item);}
  }else if(b.action==='delete'){data.items=data.items.filter(i=>i.id!==b.id);}
  else return res.status(400).json({ok:false,error:'invalid_action'});
  data.version++;data.updatedAt=new Date().toISOString();
  await put(PATH,JSON.stringify(data),{access:'private',addRandomSuffix:false,allowOverwrite:!!r,contentType:'application/json',...(r?{ifMatch:r.blob.etag.replace(/^W\//,'')}:{})});
  return res.status(200).json({ok:true,...data});
 }catch(e){
  console.error('KBI_BOARD_WRITE',e.constructor.name,String(e.message).slice(0,160));
  const conflict=/precondition|already exists/i.test(e.message)||e.constructor.name==='BlobPreconditionFailedError';
  return res.status(conflict?409:503).json({ok:false,error:conflict?'board_version_changed':'board_storage_unavailable'});
 }
};
