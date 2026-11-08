const crypto = require("crypto");
const worker = require("./crm-worker");
const knowledge = require("./crm-knowledge");
function matches(a,b){
 if(typeof a!=="string"||typeof b!=="string"||!b)return false;
 const x=Buffer.from(a), y=Buffer.from(b);
 return x.length===y.length && crypto.timingSafeEqual(x,y);
}
module.exports=async(req,res)=>{
 res.setHeader("Cache-Control","no-store");
 if(req.method!=="GET") return res.status(405).json({ok:false,error:"Method not allowed"});
 if(!matches(req.query.token,process.env.CRM_RUN_ONCE_TOKEN))
   return res.status(401).json({ok:false,error:"Unauthorized"});
 if(req.query.mode==="knowledge"){
   const innerReq={method:"POST",headers:{authorization:"Bearer "+process.env.REPORT_GATEWAY_TOKEN},query:{doc:req.query.doc}};
   return knowledge(innerReq,res);
 }
 const innerReq={method:"GET",headers:{authorization:"Bearer "+process.env.CRON_SECRET}};
 return worker(innerReq,res);
};