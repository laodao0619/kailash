const crypto=require("crypto");
const importer=require("./crm-import");
module.exports=async(req,res)=>{
 res.setHeader("Cache-Control","no-store");
 if(req.method!=="GET")return res.status(405).json({ok:false});
 const expected=process.env.CRM_IMPORT_PROBE_SECRET||"";
 const supplied=String(req.query?.token||"");
 const a=Buffer.from(expected),b=Buffer.from(supplied);
 if(!expected||a.length!==b.length||!crypto.timingSafeEqual(a,b))
  return res.status(401).json({ok:false,error:"Unauthorized"});
 return importer({method:"GET",headers:{authorization:"Bearer "+process.env.CRON_SECRET},query:{check_batch:"five"}},res);
};
