"use strict";
const crypto=require("crypto");
const {get,put}=require("@vercel/blob");
const {auditJsonl,verifyArchiveIntegrity}=require("../lib/crm-orders-ledger");
const {financeAuditConfiguration}=require("../lib/crm-finance-audit-preflight");
const ARCHIVE="crm-execution/orders-bulk-v1-export.jsonl";
const STATE="crm-execution/orders-bulk-v1-state.json";
const REPORT="crm-execution/orders-bulk-v1-audit.json";
function authorized(req){
 const secret=process.env.CRON_SECRET;
 const authorization=req.headers?.authorization;
 // A malformed or repeated Authorization header must fail closed, not throw
 // before the request reaches the protected preflight/audit gates.
 if(typeof secret!=="string"||!secret.length||typeof authorization!=="string")return false;
 const match=/^Bearer ([^\s,]+)$/i.exec(authorization);
 if(!match)return false;
 const expected=Buffer.from(secret);
 const given=Buffer.from(match[1]);
 return expected.length===given.length&&crypto.timingSafeEqual(given,expected);
}
module.exports=async(req,res)=>{
 res.setHeader("Cache-Control","no-store");
 if(req.method!=="GET")return res.status(405).json({ok:false});
 if(!authorized(req))return res.status(401).json({ok:false});
 // Protected read-only preflight: never loads bulk JSONL, saves checkpoints,
 // returns seven customer IDs, or discloses configured source counts.
 // A malformed or repeated preflight parameter must never fall through to
 // the report-writing audit path (e.g. preflight=1&preflight=1).
 if(req.query && Object.prototype.hasOwnProperty.call(req.query,"preflight") &&
    req.query.preflight!=="1")return res.status(400).json({
  ok:false,error:"invalid_preflight_mode",archiveScanned:false,feishuWrites:0
 });
 const configuration=financeAuditConfiguration(process.env);
 if(req.query?.preflight==="1")return res.status(200).json({
  ok:configuration.ready,dryRun:true,financialAuditApproved:false,
  ...configuration.diagnostic,archiveScanned:false,shopifyCalls:0,feishuWrites:0
 });
 // Missing merchant-verified sample evidence must not trigger a costly
 // archive scan or be mistaken for a zero-dollar financial fact.
 if(!configuration.ready)return res.status(409).json({
  ok:false,blockedReason:"finance_sample_config_incomplete",
  ...configuration.diagnostic,archiveScanned:false,feishuWrites:0
 });
 try{
  const archive=await get(ARCHIVE,{access:"private"});
  if(!archive||archive.statusCode!==200)return res.status(200).json({ok:true,waiting:true,reason:"full_history_not_archived"});
  // IDs and verified source counts remain in server memory and the private
  // audit report; never include them in the configuration-preflight response.
  const audit=await auditJsonl(archive.stream,{
   sampleCustomerIds:configuration.customerIds,
   sampleExpectedOrderCounts:configuration.expectedOrderCounts,
  });
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
  const evidenceComplete =
   archiveIntegrity.status==="PENDING_MANUAL_EXPORT_AND_FINANCIAL_RECONCILIATION" &&
   audit.sampleAudit?.status==="PENDING_MANUAL_SHOPIFY_FINANCIAL_RECONCILIATION";
  const reviewed={...audit,archiveIntegrity,archivedAuditAt:new Date().toISOString(),
   // Even complete evidence is pending human finance approval and is never
   // authority to change CRM grades or RFM. Block if *either* gate fails.
   status:evidenceComplete?"AUDIT_ONLY_NOT_APPROVED_FOR_RFM":"BLOCKED_FINANCIAL_EVIDENCE_INCOMPLETE"};
  await put(REPORT,JSON.stringify(reviewed),{access:"private",addRandomSuffix:false,allowOverwrite:true,contentType:"application/json"});
  return res.status(200).json({ok:true,...reviewed});
 }catch(e){
  // Provider/JSONL errors may contain private Shopify identifiers or signed
  // URLs. Never echo exception messages to API callers or runtime logs.
  return res.status(502).json({ok:false,retryable:true,error:"finance_audit_unavailable"});
 }
};
