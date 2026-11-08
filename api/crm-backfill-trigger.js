const crypto=require("crypto");
const handler=require("./crm-backfill");
module.exports=async(req,res)=>{
 res.setHeader("Cache-Control","no-store");
 if(req.method!=="GET")return res.status(405).json({ok:false});
 const supplied=String(req.query?.token||""), expected=process.env.CRM_HISTORICAL_TRIGGER||"";
 const a=Buffer.from(supplied),b=Buffer.from(expected);
 if(!expected||a.length!==b.length||!crypto.timingSafeEqual(a,b))return res.status(401).json({ok:false});
 return handler({method:"GET",headers:{authorization:"Bearer "+process.env.CRON_SECRET},query:{pages:req.query?.pages||"6"}},res);
};