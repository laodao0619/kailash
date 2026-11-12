"use strict";
const crypto=require("crypto");
const {get,put}=require("@vercel/blob");
const {auditJsonl,verifyArchiveIntegrity}=require("../lib/crm-orders-ledger");
const ARCHIVE="crm-execution/orders-bulk-v1-export.jsonl";
const STATE="crm-execution/orders-bulk-v1-state.json";
const REPORT="crm-execution/orders-bulk-v1-audit.json";
function authorized(req){
 const expected=Buffer.from(process.env.CRON_SECRET||"");
 const given=Buffer.from((req.headers.authorization||"").replace(/^Bearer\s+/i,""));
 return !!expected.length&&expected.length===given.length&&crypto.timingSafeEqual(given,expected);
}
module.exports=async(req,res)=>{
 res.setHeader("Cache-Control","no-store");
 if(req.method!=="GET")return res.status(405).json({ok:false});
 if(!authorized(req))return res.status(401).json({ok:false});
 try{
  const archive=await get(ARCHIVE,{access:"private"});
  if(!archive||archive.statusCode!==200)return res.status(200).json({ok:true,waiting:true,reason:"full_history_not_archived"});
  // Merchant-selected Shopify GIDs are confidential operational data. They
  // must be configured server-side; this endpoint is CRON_SECRET protected.
  // Missing/partial samples are reported as BLOCKED, never invented.
  const sampleCustomerIds=(process.env.CRM_FINANCE_SAMPLE_CUSTOMER_IDS||"")
   .split(",").map(x=>x.trim()).filter(Boolean);
  const audit=await auditJsonl(archive.stream,{sampleCustomerIds});
  // Do not mark a partial or mismatched private archive as audit-ready. Shopify
  // supplies objectCount and rootObjectCount for the same finished Bulk job.
  const stateResponse=await get(STATE,{access:"private"});
  let state=null;
  if(stateResponse&&stateResponse.statusCode===200){
   const chunks=[];let bytes=0;
   for await(const part of stateResponse.stream){
    const chunk=Buffer.from(part);bytes+=chunk.length;
    if(bytes>16384)throw Error("Oversized private bulk export state");
    chunks.push(chunk);
   }
   state=JSON.parse(Buffer.concat(chunks).toString("utf8"));
  }
  const archiveIntegrity=verifyArchiveIntegrity(audit,state);
  const reviewed={...audit,archiveIntegrity,archivedAuditAt:new Date().toISOString(),
   status:archiveIntegrity.status==="PENDING_MANUAL_EXPORT_AND_FINANCIAL_RECONCILIATION"?
    "AUDIT_ONLY_NOT_APPROVED_FOR_RFM":"BLOCKED_RAW_EXPORT_INTEGRITY"};
  await put(REPORT,JSON.stringify(reviewed),{access:"private",addRandomSuffix:false,allowOverwrite:true,contentType:"application/json"});
  return res.status(200).json({ok:true,...reviewed});
 }catch(e){return res.status(502).json({ok:false,retryable:true,error:String(e.message||e).slice(0,180)});}
};
