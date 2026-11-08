"use strict";
// Live, read-only Shopify customer search. This endpoint does not grade RFM.
const crypto=require("node:crypto");
const shopify=require("../lib/crm-shopify");
const QUERY=`query KbiCustomers($cursor:String,$filter:String){
 customers(first:40,after:$cursor,query:$filter,sortKey:ID){
  pageInfo{hasNextPage endCursor}
  nodes{
   id firstName lastName createdAt numberOfOrders
   amountSpent{amount currencyCode}
   defaultEmailAddress{emailAddress marketingState}
   defaultAddress{country}
   lastOrder{processedAt}
  }
 }
}`;
function authorized(req){
 const expected=String(process.env.KBI_ACCESS_TOKEN||"");
 const supplied=String(req.headers?.authorization||"").replace(/^Bearer\s+/i,"");
 if(expected.length<24||!supplied)return false;
 return crypto.timingSafeEqual(crypto.createHash("sha256").update(expected).digest(),
  crypto.createHash("sha256").update(supplied).digest());
}
function normalize(node){
 const money=node.amountSpent;
 const amount=money?.amount==null?null:Number(money.amount);
 return {
  id:node.id?.split("/").at(-1)||"",
  name:[node.firstName,node.lastName].filter(Boolean).join(" "),
  email:node.defaultEmailAddress?.emailAddress||"",
  subscribed:node.defaultEmailAddress?.marketingState||null,
  country:node.defaultAddress?.country||"",
  lifetimeOrders:node.numberOfOrders==null?null:Number(node.numberOfOrders),
  lifetimeSpend:Number.isFinite(amount)?amount:null,
  currency:money?.currencyCode||null,
  lastOrder:node.lastOrder?.processedAt||null,
  tier:null,quality:"Shopify verified identity",
  syncedAt:Date.now()
 };
}
module.exports=async(req,res)=>{
 res.setHeader("Cache-Control","private, no-store");
 res.setHeader("X-Content-Type-Options","nosniff");
 if(req.method!=="GET")return res.status(405).json({ok:false,error:"method_not_allowed"});
 if(!process.env.KBI_ACCESS_TOKEN)return res.status(503).json({ok:false,error:"kbi_access_not_configured"});
 if(!authorized(req))return res.status(401).json({ok:false,error:"unauthorized"});
 if(!process.env.SHOPIFY_SHOP_DOMAIN||
    !(process.env.SHOPIFY_ADMIN_ACCESS_TOKEN||
      (process.env.SHOPIFY_CLIENT_ID&&process.env.SHOPIFY_CLIENT_SECRET)))
  return res.status(503).json({ok:false,error:"shopify_backend_not_configured"});
 const raw=String(req.query?.q||"").trim();
 const cursor=String(req.query?.cursor||"").trim();
 if(raw.length>100||cursor.length>500)return res.status(400).json({ok:false,error:"bad_query"});
 // Remove Shopify search grammar operators from user-provided phrases.
 const q=raw.replace(/[^\p{L}\p{N} .@_+\-]/gu," ").trim()||null;
 try{
  const data=await shopify.queryShopify(QUERY,{cursor:cursor||null,filter:q});
  const conn=data.customers;
  if(!conn||!Array.isArray(conn.nodes)||!conn.pageInfo)
   return res.status(502).json({ok:false,error:"invalid_shopify_response"});
  const customers=conn.nodes.map(normalize).filter(c=>c.id);
  return res.status(200).json({
   ok:true,asOf:new Date().toISOString(),source:"Shopify Admin (live)",
   customers,pageSize:40,nextCursor:conn.pageInfo.hasNextPage?conn.pageInfo.endCursor:null,
   complete:!conn.pageInfo.hasNextPage,
   total:null,scanned:null,
   coverage:{quality:"Shopify identity only; no QQ/bot quality audit applied",
    rfm:"unverified; 2026-11-08 full-history net ledger required",
    customerCount:"not_query_counted"}
  });
 }catch(_){return res.status(502).json({ok:false,error:"shopify_unavailable"});}
};
