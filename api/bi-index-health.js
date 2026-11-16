"use strict";
// Public operational health: non-PII counts/timestamps only.
const {read,STATE,CURRENT}=require("./bi-index-build");
module.exports=async(req,res)=>{
 res.setHeader("Cache-Control","no-store");
 if(req.method!=="GET")return res.status(405).json({ok:false,error:"method"});
 try{
  const [state,current,qa]=await Promise.all([read(STATE),read(CURRENT),read("kbi-index/v2/production-qa.json")]);
  // A historical QA document remains evidence, not current deployment approval.
  // Fail closed when the deployment identity is unavailable or has changed.
  const qaCurrentDeployment=!!(qa&&qa.version===5&&process.env.VERCEL_URL&&
   qa.deploymentId===process.env.VERCEL_URL);
  return res.status(200).json({ok:true,ready:!!(current&&current.version===2&&current.total>=1000),
   build:state?{slot:state.slot,complete:!!state.complete,page:state.page,records:state.records,
    startedAt:state.startedAt,completedAt:state.completedAt||null}:null,
   snapshot:current?{generatedAt:current.generatedAt,total:current.total,slot:current.slot,
    source:current.source,grading:"historical_snapshot_not_final_audit"}:null,
   productionQA:qa?{ready:qa.ready===true&&qaCurrentDeployment,
    qaCurrentDeployment,at:qa.at,checks:qa.checks,metrics:qa.metrics}:null});
 }catch(_){return res.status(503).json({ok:false,error:"health_unavailable"});}
};
