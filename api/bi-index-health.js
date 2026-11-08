"use strict";
// Public operational health: non-PII counts/timestamps only.
const {read,STATE,CURRENT}=require("./bi-index-build");
module.exports=async(req,res)=>{
 res.setHeader("Cache-Control","no-store");
 if(req.method!=="GET")return res.status(405).json({ok:false,error:"method"});
 try{
  const [state,current]=await Promise.all([read(STATE),read(CURRENT)]);
  return res.status(200).json({ok:true,ready:!!(current&&current.version===2&&current.total>=1000),
   build:state?{slot:state.slot,complete:!!state.complete,page:state.page,records:state.records,
    startedAt:state.startedAt,completedAt:state.completedAt||null}:null,
   snapshot:current?{generatedAt:current.generatedAt,total:current.total,slot:current.slot,
    source:current.source,grading:"historical_snapshot_not_final_audit"}:null});
 }catch(_){return res.status(503).json({ok:false,error:"health_unavailable"});}
};
