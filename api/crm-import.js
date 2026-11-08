module.exports=async(_req,res)=>{
 res.setHeader("Cache-Control","no-store");
 return res.status(410).json({ok:false,retired:true,reason:"Replaced by audited Shopify historical backfill and strictly filtered Gmail importer"});
};
