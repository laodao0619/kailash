"use strict";
const crypto=require("node:crypto");
const cases=require("../lib/crm-cases");
function authorized(req){
 const s=String(process.env.KBI_ACCESS_TOKEN||""),v=String(req.headers?.authorization||"").replace(/^Bearer\s+/i,"");
 return s.length>=24&&!!v&&crypto.timingSafeEqual(crypto.createHash("sha256").update(s).digest(),crypto.createHash("sha256").update(v).digest());
}
module.exports=async(req,res)=>{
 res.setHeader("Cache-Control","private, no-store");
 if(req.method!=="GET")return res.status(405).json({ok:false,error:"method"});
 if(!authorized(req))return res.status(401).json({ok:false,error:"unauthorized"});
 try{
  const events=await cases.allEvents(500);
  const grouped=cases.groupCases(events);
  const priority=String(req.query?.priority||"");
  const q=String(req.query?.q||"").trim().toLowerCase().slice(0,90);
  const matches=grouped.filter(x=>(!priority||String(x.priority||x.urgency||"")===priority)&&
   (!q||JSON.stringify(x).toLowerCase().includes(q)));
  const page=Math.max(1,Math.min(1000,parseInt(req.query?.page,10)||1));
  const limit=20;
  return res.status(200).json({ok:true,scannedEvents:events.length,scannedCases:grouped.length,
   total:matches.length,page,pageCount:Math.ceil(matches.length/limit),
   cases:matches.slice((page-1)*limit,page*limit),
   coverage:"latest_500_archived_events_only",
   note:"Case is a triage candidate. A customer service reply is not a resolved issue."});
 }catch(_){return res.status(503).json({ok:false,error:"case_data_unavailable"});}
};
