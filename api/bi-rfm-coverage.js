"use strict";
const crypto=require("node:crypto");
const {read,CURRENT}=require("./bi-index-build");
const {audit}=require("../lib/kbi-rfm-coverage");
function authorized(req){
 const expected=String(process.env.KBI_ACCESS_TOKEN||"");
 const got=String(req.headers?.authorization||"").replace(/^Bearer\s+/i,"");
 if(expected.length<24||!got)return false;
 const a=crypto.createHash("sha256").update(expected).digest();
 const b=crypto.createHash("sha256").update(got).digest();
 return crypto.timingSafeEqual(a,b);
}
module.exports=async(req,res)=>{
 res.setHeader("Cache-Control","private, no-store");
 res.setHeader("X-Content-Type-Options","nosniff");
 if(req.method!=="GET")return res.status(405).json({ok:false,error:"method"});
 if(String(process.env.KBI_ACCESS_TOKEN||"").length<24)
  return res.status(503).json({ok:false,error:"kbi_auth_not_configured"});
 if(!authorized(req))return res.status(401).json({ok:false,error:"unauthorized"});
 try{
  // Use private published Blob only. Never fall back to a full Feishu scan.
  const data=await read(CURRENT);
  if(!data||data.version!==2||!Array.isArray(data.customers)||
   data.customers.length<1000||data.total!==data.customers.length)
   return res.status(503).json({ok:false,error:"published_index_incomplete"});
  return res.status(200).json({ok:true,snapshotAt:data.generatedAt,
   source:"published_private_crm_index",auditStatus:"historical_snapshot_not_final_financial_audit",
   coverage:audit(data.customers)});
 }catch(_){return res.status(503).json({ok:false,error:"coverage_unavailable"});}
};
