"use strict";
// Read-only 180-day order snapshot. No CRM grades are written until the full
// snapshot has been collected and reconciled with the customer master.
const crypto=require("crypto");
const {get,put}=require("@vercel/blob");
const shopify=require("../lib/crm-shopify");
const PATH="crm-execution/orders-stage-state.json";
function authorized(req){
 const expected=Buffer.from(process.env.CRON_SECRET||"");
 const given=Buffer.from((req.headers.authorization||"").replace(/^Bearer\s+/i,""));
 return !!expected.length&&expected.length===given.length&&crypto.timingSafeEqual(expected,given);
}
async function read(path){
 const r=await get(path,{access:"private"});
 if(!r||r.statusCode!==200)return null;
 const chunks=[];for await(const x of r.stream)chunks.push(x);
 return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
async function save(path,value){
 await put(path,JSON.stringify(value),{access:"private",addRandomSuffix:false,allowOverwrite:true,contentType:"application/json"});
}
module.exports=async(req,res)=>{
 res.setHeader("Cache-Control","no-store");
 if(req.method!=="GET")return res.status(405).json({ok:false});
 if(!authorized(req))return res.status(401).json({ok:false});
 try{
  const scopes=await shopify.orderAccess();
  if(!scopes.read_all_orders)return res.status(200).json({ok:true,paused:true,reason:"read_all_orders_not_granted"});
  const now=new Date();
  const state=await read(PATH)||{
   startedAt:now.toISOString(),
   since:new Date(now.getTime()-180*86400000).toISOString(),
   page:0,cursor:null,completed:false,
   totals:{scanned:0,eligible:0,excluded:0,unknown_currency:0,pages:0}
  };
  if(state.completed)return res.status(200).json({ok:true,completed:true,totals:state.totals,since:state.since});
  const start=Date.now();let pages=0;
  for(let i=0;i<12&&Date.now()-start<90000;i++){
   const connection=await shopify.orders(state.cursor||null,state.since);
   if(!connection?.nodes||!connection?.pageInfo)throw Error("Malformed Shopify orders connection");
   const normalized=[];
   for(const order of connection.nodes){
    state.totals.scanned++;
    const record=shopify.checkedOrder(order);
    if(!record||!record.customerId){state.totals.excluded++;continue;}
    if(!record.verified){state.totals.unknown_currency++;continue;}
    normalized.push(record);
    state.totals.eligible++;
   }
   // A page is immutable within the checkpoint; repeating a failed page
   // overwrites its same path and cannot double-count at reconciliation.
   await save("crm-execution/orders-stage/page-"+state.page+".json",{orders:normalized});
   state.page++;
   state.totals.pages=state.page;
   state.cursor=connection.pageInfo.hasNextPage?connection.pageInfo.endCursor:null;
   state.completed=!connection.pageInfo.hasNextPage;
   state.updatedAt=new Date().toISOString();
   await save(PATH,state);
   pages++;
   if(state.completed)break;
  }
  return res.status(200).json({ok:true,phase:"orders_snapshot",completed:state.completed,pages_this_run:pages,totals:state.totals,since:state.since,note:"Verified source snapshot only. CRM grades are not computed from partial history."});
 }catch(e){return res.status(502).json({ok:false,retryable:true,error:String(e.message||e).slice(0,180)});}
};
