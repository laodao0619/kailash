"use strict";
const crypto=require("crypto"),feishu=require("../lib/crm-feishu");
const {result}=require("../lib/crm-dashboard-metrics");
const ROOT="https://open.feishu.cn/open-apis/bitable/v1/apps/Y7VvbgreAasoLtsYdhrcmmDUn5d/tables/";
function authorized(req){
 const supplied=Buffer.from((req.headers.authorization||"").replace(/^Bearer\s+/i,""));
 return [process.env.REPORT_GATEWAY_TOKEN,process.env.CRON_SECRET].some(secret=>{
  const expected=Buffer.from(secret||"");return !!expected.length&&expected.length===supplied.length&&crypto.timingSafeEqual(expected,supplied);
 });
}
async function records(token,table){
 const rows=[];let cursor;
 for(let page=0;page<100;page++){
  const u=new URL(ROOT+table+"/records");u.searchParams.set("page_size","500");if(cursor)u.searchParams.set("page_token",cursor);
  const r=await fetch(u,{headers:{Authorization:"Bearer "+token}});
  const j=await r.json().catch(()=>({}));
  if(!r.ok||j.code!==0)throw Error("Feishu aggregation read failed");
  rows.push(...(j.data?.items||[]));
  if(!j.data?.has_more)return rows;
  cursor=j.data?.page_token;if(!cursor)throw Error("Feishu aggregation pagination failed");
 }
 throw Error("Feishu aggregation page limit reached; refusing incomplete dashboard");
}
module.exports=async(req,res)=>{
 res.setHeader("Cache-Control","private, no-store");
 if(req.method!=="GET")return res.status(405).json({ok:false});
 if(!authorized(req))return res.status(401).json({ok:false});
 try{
  const t=await feishu.tenantToken();
  const [customers,communications]=await Promise.all([records(t,"tblbk7Ju6fcM1BXF"),records(t,"tblNi7C5q5FYlG06")]);
  return res.status(200).json({ok:true,dashboards:result(customers,communications)});
 }catch(e){return res.status(502).json({ok:false,error:String(e.message||e).slice(0,150)});}
};
