"use strict";
// Safe setup diagnostics: reports missing configuration categories, never env values.
module.exports=(req,res)=>{
 res.setHeader("Cache-Control","no-store");
 res.setHeader("X-Content-Type-Options","nosniff");
 if(req.method!=="GET")return res.status(405).json({ok:false});
 const auth=typeof process.env.KBI_ACCESS_TOKEN==="string"&&process.env.KBI_ACCESS_TOKEN.length>=24;
 const shopify=!!(process.env.SHOPIFY_SHOP_DOMAIN&&
  (process.env.SHOPIFY_ADMIN_ACCESS_TOKEN||
   (process.env.SHOPIFY_CLIENT_ID&&process.env.SHOPIFY_CLIENT_SECRET)));
 const gmail=!!(process.env.GMAIL_CLIENT_ID&&process.env.GMAIL_CLIENT_SECRET&&process.env.GMAIL_REFRESH_TOKEN);
 const feishu=!!(process.env.FEISHU_APP_ID&&process.env.FEISHU_APP_SECRET);
 return res.status(200).json({
  ok:true,accessReady:auth,customerSourceReady:shopify||feishu,
  journeySourceReady:shopify,
  emailSourceReady:gmail,readiness:!auth?"access_not_configured":
   !shopify&&!feishu?"data_source_not_configured":
   "login_available",
  note:"Configuration presence only; not API connectivity or business data validation."
 });
};
