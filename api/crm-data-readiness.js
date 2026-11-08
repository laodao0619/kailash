const API="https://open.feishu.cn/open-apis",BASE="Y7VvbgreAasoLtsYdhrcmmDUn5d";
async function get(t,path){
 const r=await fetch(API+path,{headers:{Authorization:"Bearer "+t}});
 const j=await r.json().catch(()=>({}));
 return {ok:r.ok&&j.code===0,code:j.code,data:j.data||{},status:r.status};
}
module.exports=async(req,res)=>{
 res.setHeader("Cache-Control","no-store");
 if(req.method!=="GET")return res.status(405).json({ok:false});
 try{
  const a=await fetch(API+"/auth/v3/tenant_access_token/internal",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({app_id:process.env.FEISHU_APP_ID,app_secret:process.env.FEISHU_APP_SECRET})});
  const j=await a.json();
  if(!a.ok||j.code!==0||!j.tenant_access_token)return res.status(200).json({ok:false,reason:"feishu_auth"});
  const token=j.tenant_access_token;
  const [dash,clients,follow,views1,views2]=await Promise.all([
    get(token,"/bitable/v1/apps/"+BASE+"/dashboards?page_size=100"),
    get(token,"/bitable/v1/apps/"+BASE+"/tables/tblbk7Ju6fcM1BXF/records?page_size=10"),
    get(token,"/bitable/v1/apps/"+BASE+"/tables/tblNi7C5q5FYlG06/records?page_size=10"),
    get(token,"/bitable/v1/apps/"+BASE+"/tables/tblbk7Ju6fcM1BXF/views?page_size=100"),
    get(token,"/bitable/v1/apps/"+BASE+"/tables/tblNi7C5q5FYlG06/views?page_size=100")
  ]);
  function active(data,field){return (data.items||[]).filter(x=>x.fields && x.fields[field] && JSON.stringify(x.fields[field])!=="[]").length;}
  return res.status(200).json({ok:true,checks:{
   dashboards_readable:dash.ok,
   existing_dashboard_count:dash.ok?(dash.data.items||[]).length:null,
   existing_dashboard_titles:dash.ok?(dash.data.items||[]).map(x=>x.name||x.title||"unnamed"):[],
   customer_table_readable:clients.ok,customer_sample_rows:(clients.data.items||[]).length,
   imported_customer_sample_count:active(clients.data,"Shopify客户ID"),
   communication_table_readable:follow.ok,communication_sample_rows:(follow.data.items||[]).length,
   imported_communication_sample_count:active(follow.data,"沟通记录编号"),
   master_views:(views1.data.items||[]).map(x=>x.view_name),
   followup_views:(views2.data.items||[]).map(x=>x.view_name)
  }});
 }catch(e){return res.status(200).json({ok:false,reason:"health_check_failed"});}
};