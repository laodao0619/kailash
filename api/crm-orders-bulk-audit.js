"use strict";
const crypto=require("crypto");
const {get,put}=require("@vercel/blob");
const {auditJsonl}=require("../lib/crm-orders-ledger");
const ARCHIVE="crm-execution/orders-bulk-v1-export.jsonl";
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
  const reviewed={...audit,archivedAuditAt:new Date().toISOString(),status:"AUDIT_ONLY_NOT_APPROVED_FOR_RFM"};
  await put(REPORT,JSON.stringify(reviewed),{access:"private",addRandomSuffix:false,allowOverwrite:true,contentType:"application/json"});
  return res.status(200).json({ok:true,...reviewed});
 }catch(e){return res.status(502).json({ok:false,retryable:true,error:String(e.message||e).slice(0,180)});}
};
