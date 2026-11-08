"use strict";
const crypto=require("node:crypto");
const {snapshot}=require("./bi-customers-v2");
const {summarize}=require("../lib/kbi-workbench-summary");
function auth(req){
 const secret=String(process.env.KBI_ACCESS_TOKEN||"");
 const got=String(req.headers?.authorization||"").replace(/^Bearer\s+/i,"");
 return secret.length>=24&&!!got&&crypto.timingSafeEqual(
  crypto.createHash("sha256").update(secret).digest(),
  crypto.createHash("sha256").update(got).digest());
}
module.exports=async(req,res)=>{
 res.setHeader("Cache-Control","private, no-store");
 res.setHeader("X-Content-Type-Options","nosniff");
 if(req.method!=="GET")return res.status(405).json({ok:false,error:"method"});
 if(!auth(req))return res.status(401).json({ok:false,error:"unauthorized"});
 try{const data=await snapshot();return res.status(200).json({ok:true,...summarize(data)});}
 catch(_){return res.status(503).json({ok:false,error:"crm_snapshot_unavailable"});}
};
