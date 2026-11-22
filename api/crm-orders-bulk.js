"use strict";
// Independent full-history Shopify export. Never changes the active RFM table.
const crypto=require("crypto");
const {get,put}=require("@vercel/blob");
const shopify=require("../lib/crm-shopify");
const bulk=require("../lib/crm-orders-bulk");
const STATE="crm-execution/orders-bulk-v1-state.json";
const RAW="crm-execution/orders-bulk-v1-export.jsonl";
function authorized(req){
 const expected=Buffer.from(process.env.CRON_SECRET||"");
 const given=Buffer.from((req.headers.authorization||"").replace(/^Bearer\s+/i,""));
 return !!expected.length&&expected.length===given.length&&crypto.timingSafeEqual(given,expected);
}
async function read(){
 // Private Blob overwrites can remain CDN-cached for up to 60 seconds.
 // Read the latest checkpoint before deciding whether a Bulk export may start.
 const result=await get(STATE,{access:"private",useCache:false});
 if(!result||result.statusCode===404)return null;
 if(result.statusCode!==200)throw Error("Private bulk export checkpoint unavailable");
 // A corrupt or oversized persisted checkpoint is never equivalent to a
 // missing checkpoint. Do not start a second Shopify export on bad evidence.
 const chunks=[];let bytes=0;
 for await(const part of result.stream){
  const chunk=Buffer.from(part);bytes+=chunk.length;
  if(bytes>16384)throw Error("Private bulk export checkpoint exceeds size limit");
  chunks.push(chunk);
 }
 let state;
 try{state=JSON.parse(Buffer.concat(chunks).toString("utf8"));}
 catch{throw Error("Private bulk export checkpoint invalid JSON");}
 if(!state||typeof state!=="object"||Array.isArray(state)||
    typeof state.id!=="string"||!state.id.trim()||
    typeof state.status!=="string"||!state.status.trim()||
    typeof state.downloaded!=="boolean"||
    (state.downloaded&&(state.completed!==true||state.status!=="COMPLETED")))
  throw Error("Private bulk export checkpoint invalid structure");
 return state;
}
async function save(s){
 s.updatedAt=new Date().toISOString();
 await put(STATE,JSON.stringify(s),{access:"private",addRandomSuffix:false,allowOverwrite:true,contentType:"application/json"});
}
module.exports=async(req,res)=>{
 res.setHeader("Cache-Control","no-store");
 if(req.method!=="GET")return res.status(405).json({ok:false});
 if(!authorized(req))return res.status(401).json({ok:false});
 try{
  // Never initiate a full-history export just because a preview or cron was deployed.
  // Merchant opt-in is required independently of Shopify API scopes.
  if(!bulk.isExplicitBulkExportEnabled(process.env))
   return res.status(200).json({ok:true,paused:true,reason:"bulk_requires_explicit_approval"});
  const scopes=await shopify.orderAccess();
  if(!scopes.read_orders||!scopes.read_all_orders||!scopes.read_products)
   return res.status(200).json({ok:true,paused:true,reason:"missing_shopify_scopes",scopes});
  let state=await read();
  if(!state){
   // A lost checkpoint must never authorize re-exporting or overwriting an
   // existing immutable archive. Require explicit reconciliation first.
   const existingArchive=await get(RAW,{access:"private"});
   if(existingArchive?.statusCode===200)return res.status(409).json({
    ok:false,blockedReason:"bulk_archive_exists_without_checkpoint",reviewRequired:true
   });
   if(existingArchive&&existingArchive.statusCode!==404)
    throw Error("Private bulk export archive status unavailable");
   const op=await bulk.start(shopify.queryShopify);
   state={id:op.id,status:op.status,startedAt:new Date().toISOString(),completed:false,downloaded:false};
   await save(state);
   return res.status(200).json({ok:true,phase:"started",status:state.status});
  }
  if(state.downloaded){
   // A checkpoint alone does not prove that the immutable financial evidence
   // is still present. Never report a completed archive after Blob loss.
   const archived=await get(RAW,{access:"private"});
   if(!archived || archived.statusCode===404)return res.status(409).json({
    ok:false,blockedReason:"bulk_archive_missing_after_checkpoint",reviewRequired:true
   });
   if(archived.statusCode!==200)throw Error("Private bulk export archive unavailable");
   return res.status(200).json({ok:true,phase:"archived",completed:true,objectCount:state.objectCount,rootObjectCount:state.rootObjectCount});
  }
  const op=await bulk.poll(shopify.queryShopify,state.id);
  state.status=op.status;
  if(op.status==="FAILED"||op.status==="CANCELED"||op.status==="EXPIRED"){
   state.errorCode=op.errorCode||null;await save(state);
   return res.status(200).json({ok:false,phase:"bulk_failed",status:state.status,errorCode:state.errorCode,restart_requires_review:true});
  }
  if(op.status!=="COMPLETED"){
   await save(state);return res.status(200).json({ok:true,phase:"running",status:op.status,objectCount:op.objectCount});
  }
  state.completed=true;state.objectCount=op.objectCount;state.rootObjectCount=op.rootObjectCount;
  if(!op.url)throw Error("Shopify bulk operation completed without a download URL");
  const url=bulk.downloadUrl(op.url);
  const response=await fetch(url,{redirect:"error",signal:AbortSignal.timeout(85000)});
  if(!response.ok||!response.body)throw Error("Shopify bulk export download failed: "+response.status);
  // Store raw immutable-format JSONL in private Blob, then reconcile separately.
  await put(RAW,response.body,{access:"private",addRandomSuffix:false,allowOverwrite:false,contentType:"application/x-ndjson"});
  state.downloaded=true;state.archivedAt=new Date().toISOString();await save(state);
  return res.status(200).json({ok:true,phase:"archived",completed:true,objectCount:state.objectCount,rootObjectCount:state.rootObjectCount});
 }catch{
  // Upstream exceptions may contain signed Blob URLs, order identifiers or
  // private runtime configuration. Never include raw messages in HTTP errors.
  return res.status(502).json({ok:false,retryable:true,error:"bulk_export_failed"});
 }
};
