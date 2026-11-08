const shopify=require("../lib/crm-shopify");
module.exports=async(req,res)=>{
 res.setHeader("Cache-Control","no-store");
 if(req.method!=="GET")return res.status(405).json({ok:false});
 try{
  const page=await shopify.customers(null);
  const rows=page?.nodes||[];
  return res.status(200).json({
    ok:true,source:"Shopify Admin 2026-10",
    token_exchange:"verified",customer_query:"verified",
    sample_count:rows.length,
    more_pages:!!page?.pageInfo?.hasNextPage,
    pii_returned:false
  });
 }catch(e){
  const msg=String(e.message||"");
  const category=msg.includes("token request failed")?"token_exchange_failed":msg.includes("not configured")?"credentials_missing":msg.includes("query failed")?"admin_scope_or_graphql":msg.includes("domain")?"invalid_domain":"connection_error";
  return res.status(200).json({ok:false,category,diagnostic:msg.replace(/[A-Za-z0-9-_]{35,}/g,"[redacted]").slice(0,170)});
 }
};