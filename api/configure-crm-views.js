const API = "https://open.feishu.cn/open-apis";
const BASE = "Y7VvbgreAasoLtsYdhrcmmDUn5d";
const SPECS = [
  {table:"tblbk7Ju6fcM1BXF",views:[["客户价值分析","grid"],["客户旅程总览","grid"]]},
  {table:"tblNi7C5q5FYlG06",views:[["客户跟进看板","kanban"],["客户沟通档案","grid"]]}
];
async function call(token,path,method="GET",body) {
  const response=await fetch(API+path,{method,headers:{
    Authorization:"Bearer "+token,"Content-Type":"application/json"
  },...(body?{body:JSON.stringify(body)}:{})});
  const data=await response.json().catch(()=>({}));
  if(!response.ok||data.code!==0)throw new Error((data.msg||response.statusText)+" ["+path+"]");
  return data.data||data;
}
module.exports=async(req,res)=>{
  const expected=process.env.REPORT_GATEWAY_TOKEN||"";
  const supplied=(req.headers.authorization||"").replace(/^Bearer\s+/i,"");
  if(req.method!=="POST")return res.status(405).json({ok:false});
  if(!expected||expected!==supplied)return res.status(401).json({ok:false});
  try{
    const ar=await fetch(API+"/auth/v3/tenant_access_token/internal",{
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({app_id:process.env.FEISHU_APP_ID,app_secret:process.env.FEISHU_APP_SECRET})
    });
    const a=await ar.json();
    if(!ar.ok||a.code!==0||!a.tenant_access_token)throw new Error("Feishu authorization failed");
    const token=a.tenant_access_token,results=[];
    for(const spec of SPECS){
      const path="/bitable/v1/apps/"+BASE+"/tables/"+spec.table+"/views";
      const listed=await call(token,path+"?page_size=50");
      const existing=new Map((listed.items||[]).map(v=>[v.view_name,v]));
      const report=[];
      for(const [view_name,view_type] of spec.views){
        if(existing.has(view_name)){
          report.push({view_name,view_type,status:"exists"});
        }else{
          const made=await call(token,path,"POST",{view_name,view_type});
          report.push({view_name,view_type,status:"created",view_id:made.view?.view_id||made.view_id||null});
        }
      }
      results.push({table_id:spec.table,views:report});
    }
    return res.status(200).json({ok:true,records_changed:false,tables_created:false,views:results,filter_grouping_configured:false});
  }catch(e){return res.status(502).json({ok:false,error:String(e.message).slice(0,500)})}
};