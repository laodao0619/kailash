"use strict";
// KBI internal diagnostics only. Never exposes Shopify secrets, customer records,
// Gmail message metadata, bulk export download URLs or raw private storage paths.
const crypto=require("node:crypto");
const shopify=require("../lib/crm-shopify");
const BULK_QUERY=`query KbiBulkMonitor {
 currentAppInstallation { accessScopes { handle } }
 bulkOperations(first:5,query:"operation_type:query") {
  nodes { id status errorCode objectCount rootObjectCount createdAt completedAt }
 }
}`;
function authorized(req){
 const expected=process.env.KBI_ACCESS_TOKEN||"";
 const token=String(req.headers?.authorization||"").replace(/^Bearer\s+/i,"");
 if(expected.length<24||!token)return false;
 return crypto.timingSafeEqual(
  crypto.createHash("sha256").update(expected).digest(),
  crypto.createHash("sha256").update(token).digest());
}
module.exports=async(req,res)=>{
 res.setHeader("Cache-Control","private, no-store");
 res.setHeader("X-Content-Type-Options","nosniff");
 if(req.method!=="GET")return res.status(405).json({ok:false,error:"method"});
 if(!process.env.KBI_ACCESS_TOKEN)return res.status(503).json({ok:false,error:"kbi_auth_not_configured"});
 if(!authorized(req))return res.status(401).json({ok:false,error:"unauthorized"});
 const sourceReady=!!(process.env.SHOPIFY_SHOP_DOMAIN&&(process.env.SHOPIFY_ADMIN_ACCESS_TOKEN||
  (process.env.SHOPIFY_CLIENT_ID&&process.env.SHOPIFY_CLIENT_SECRET)));
 const gmailReady=!!(process.env.GMAIL_CLIENT_ID&&process.env.GMAIL_CLIENT_SECRET&&process.env.GMAIL_REFRESH_TOKEN);
 if(!sourceReady)return res.status(200).json({
  ok:true,shopify:{configured:false,authorization:"not_configured",fullHistoryReady:false,bulk:[]},
  gmail:{configured:gmailReady},audit:{status:"not_verified"},
  note:"ChatGPT connector authorization is independent of Vercel server authorization."
 });
 try{
  const data=await shopify.queryShopify(BULK_QUERY);
  const scopes=new Set((data.currentAppInstallation?.accessScopes||[]).map(x=>x.handle));
  const recent=(data.bulkOperations?.nodes||[]).map(x=>({
   id:x.id,status:x.status,errorCode:x.errorCode||null,
   objectCount:x.objectCount||null,rootObjectCount:x.rootObjectCount||null,
   createdAt:x.createdAt||null,completedAt:x.completedAt||null
  }));
  const fullHistoryReady=scopes.has("read_orders")&&scopes.has("read_all_orders")&&scopes.has("read_products");
  return res.status(200).json({
   ok:true,asOf:new Date().toISOString(),
   shopify:{configured:true,authorization:"connected",
    permissions:{read_orders:scopes.has("read_orders"),read_all_orders:scopes.has("read_all_orders"),
     read_products:scopes.has("read_products")},
    fullHistoryReady,bulk:recent},
   gmail:{configured:gmailReady},
   audit:{status:"not_verified"},
   note:"Bulk status is for this Shopify app only; completion is not financial reconciliation."
  });
 }catch(_){return res.status(200).json({
  ok:true,shopify:{configured:true,authorization:"query_failed",fullHistoryReady:false,bulk:[]},
  gmail:{configured:gmailReady},audit:{status:"not_verified"},
  note:"Shopify authorization cannot be verified from this backend environment."
 });}
};
