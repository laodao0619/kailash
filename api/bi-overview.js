"use strict";
const crypto=require("node:crypto");
const shopify=require("../lib/crm-shopify");
let cached=null, pending=null;
function authorized(req){
 const expected=String(process.env.KBI_ACCESS_TOKEN||"");
 const got=String(req.headers?.authorization||"").replace(/^Bearer\s+/i,"");
 if(expected.length<24||!got)return false;
 return crypto.timingSafeEqual(crypto.createHash("sha256").update(expected).digest(),
  crypto.createHash("sha256").update(got).digest());
}
async function getCount(){
 if(cached&&Date.now()-cached.at<60000)return cached.value;
 if(!pending)pending=shopify.customerCount().then(value=>{
  cached={at:Date.now(),value};return value;
 }).finally(()=>{pending=null;});
 return pending;
}
module.exports=async(req,res)=>{
 res.setHeader("Cache-Control","private, no-store");
 res.setHeader("X-Content-Type-Options","nosniff");
 if(req.method!=="GET")return res.status(405).json({ok:false,error:"method"});
 if(!process.env.KBI_ACCESS_TOKEN)return res.status(503).json({ok:false,error:"auth_not_configured"});
 if(!authorized(req))return res.status(401).json({ok:false,error:"unauthorized"});
 if(!process.env.SHOPIFY_SHOP_DOMAIN||
    !(process.env.SHOPIFY_ADMIN_ACCESS_TOKEN||
      (process.env.SHOPIFY_CLIENT_ID&&process.env.SHOPIFY_CLIENT_SECRET)))
  return res.status(503).json({ok:false,error:"shopify_backend_not_configured"});
 try{
  const data=await getCount();
  const count=data?.count;
  return res.status(200).json({
   ok:true,asOf:new Date().toISOString(),source:"Shopify Admin",
   customers:{count:Number.isSafeInteger(count)?count:null,
    precision:data?.precision||"UNKNOWN"},
   rfm:{status:"awaiting_full_history_net_ledger",policyVersion:"2026-11-08"},
   revenue:{status:"not_audited",amount:null},
   note:"Raw Shopify customer count includes unqualified bot/test accounts; filtered CRM count is not available until quality review."
  });
 }catch(_){return res.status(502).json({ok:false,error:"shopify_unavailable"});}
};
