const bot=require("./crm-bot-knowledge");
const API="https://open.feishu.cn/open-apis";
module.exports=async(req,res)=>{
 res.setHeader("Cache-Control","no-store");
 if(req.method!=="GET")return res.status(405).json({ok:false});
 const checks={
  rfm_rule:false,life_cycle:false,psychology:false,
  unauthorized_personal_lookup_blocked:false,
  bitable_customer_search_api:false
 };
 try{
  const [r,l,p,blocked]=await Promise.all([
   bot.answer("RFM"),bot.answer("CRM旅程"),bot.answer("CRM画像"),
   bot.answer("客户 qa-test@example.invalid",{chatType:"p2p",chatId:"test"})
  ]);
  checks.rfm_rule=r.includes("M>$0")&&r.includes("S+");
  checks.life_cycle=l.includes("复购培养");
  checks.psychology=p.includes("客户明确表达");
  checks.unauthorized_personal_lookup_blocked=blocked.includes("只能在指定的内部CRM群");
  const ar=await fetch(API+"/auth/v3/tenant_access_token/internal",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({app_id:process.env.FEISHU_APP_ID,app_secret:process.env.FEISHU_APP_SECRET})});
  const ad=await ar.json();
  if(ar.ok&&ad.code===0&&ad.tenant_access_token){
    const sr=await fetch(API+"/bitable/v1/apps/Y7VvbgreAasoLtsYdhrcmmDUn5d/tables/tblbk7Ju6fcM1BXF/records/search?page_size=1",{
      method:"POST",headers:{Authorization:"Bearer "+ad.tenant_access_token,"Content-Type":"application/json"},
      body:JSON.stringify({filter:{conjunction:"and",conditions:[{field_name:"邮箱",operator:"is",value:["qa-test@invalid.example"]}]}})
    });
    const sj=await sr.json().catch(()=>({}));
    checks.bitable_customer_search_api=sr.ok&&sj.code===0;
  }
  return res.status(200).json({ok:Object.values(checks).every(Boolean),checks});
 }catch(e){return res.status(200).json({ok:false,checks,error_category:"selftest_failed"});}
};