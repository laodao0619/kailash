"use strict";
const crypto=require("node:crypto");
const shopify=require("../lib/crm-shopify");
const QUERY=`query KbiCatalog($filter:String!){
 products(first:36,query:$filter,sortKey:UPDATED_AT,reverse:true){
  pageInfo{hasNextPage}
  nodes{
   id title handle productType onlineStoreUrl updatedAt
   featuredMedia{preview{image{url altText}}}
   priceRangeV2{minVariantPrice{amount currencyCode}}
  }
 }
}`;
function auth(req){
 const a=String(process.env.KBI_ACCESS_TOKEN||""),b=String(req.headers?.authorization||"").replace(/^Bearer\s+/i,"");
 return a.length>=24&&!!b&&crypto.timingSafeEqual(crypto.createHash("sha256").update(a).digest(),crypto.createHash("sha256").update(b).digest());
}
module.exports=async(req,res)=>{
 res.setHeader("Cache-Control","private, no-store");
 if(req.method!=="GET")return res.status(405).json({ok:false,error:"method"});
 if(!auth(req))return res.status(401).json({ok:false,error:"unauthorized"});
 const q=String(req.query?.q||"").trim().replace(/["\\]/g,"").slice(0,65);
 const filter="status:active"+(q?" AND title:*"+q.split(/\s+/).join("*"):"");
 try{
  const data=await shopify.queryShopify(QUERY,{filter});
  const conn=data.products;
  return res.status(200).json({ok:true,products:(conn?.nodes||[]).map(p=>({
   id:p.id,title:p.title,productType:p.productType||"未分类",
   url:p.onlineStoreUrl||null,image:p.featuredMedia?.preview?.image?.url||null,
   price:p.priceRangeV2?.minVariantPrice||null,updatedAt:p.updatedAt
  })),hasMore:!!conn?.pageInfo?.hasNextPage,
  scope:"latest_36_active_products_not_sales_ranking",
  note:"This is a current product catalog, not historical best sellers or product profitability."});
 }catch(_){return res.status(502).json({ok:false,error:"shopify_products_unavailable"});}
};
