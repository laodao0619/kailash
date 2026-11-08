"use strict";
const API="https://open.feishu.cn/open-apis";
const APP="Y7VvbgreAasoLtsYdhrcmmDUn5d";
const MASTER="tblbk7Ju6fcM1BXF",CONTACTS="tblNi7C5q5FYlG06";
async function tenantToken(){
 const r=await fetch(API+"/auth/v3/tenant_access_token/internal",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({app_id:process.env.FEISHU_APP_ID,app_secret:process.env.FEISHU_APP_SECRET})});
 const j=await r.json();
 if(!r.ok||j.code!==0||!j.tenant_access_token)throw Error("Feishu OAuth failed");
 return j.tenant_access_token;
}
async function request(t,path,method="GET",payload){
 const r=await fetch(API+path,{
  method,headers:{Authorization:"Bearer "+t,"Content-Type":"application/json"},
  ...(payload?{body:JSON.stringify(payload)}:{})
 });
 const j=await r.json().catch(()=>({}));
 if(!r.ok||j.code!==0)throw Error("Feishu Bitable "+r.status+" / "+(j.msg||"unknown"));
 return j.data||{};
}
async function findBy(t,table,field,value){
 const path="/bitable/v1/apps/"+APP+"/tables/"+table+"/records/search?page_size=5";
 const j=await request(t,path,"POST",{filter:{conjunction:"and",conditions:[{field_name:field,operator:"is",value:[value]}]}});
 return j.items||[];
}
async function upsertCustomer(t,customer){
 if(!customer?.id)throw Error("Shopify customer ID required");
 const records=await findBy(t,MASTER,"Shopify客户ID",customer.id);
 if(records.length>1)throw Error("Duplicate Shopify ID in Feishu; manual resolution required");
 const id=customer.id;
 const email=customer.defaultEmailAddress?.emailAddress?.toLowerCase()||"";
 const name=[customer.firstName,customer.lastName].filter(Boolean).join(" ");
 const fields={
  "Shopify客户ID":id,
  "客户唯一编号":id,
  "客户姓名":name,
  "邮箱":email,
  "国家地区":customer.defaultAddress?.country||"",
  "历史订单数":Number(customer.numberOfOrders)||0
 };
 const raw=customer.amountSpent;
 if(raw?.currencyCode==="USD"&&Number.isFinite(Number(raw.amount)))fields["历史累计消费"]=Number(raw.amount);
 const now=Date.now();
 fields["数据最后同步时间"]=now;
 const path="/bitable/v1/apps/"+APP+"/tables/"+MASTER+"/records";
 if(records.length){
  await request(t,path+"/"+records[0].record_id,"PUT",{fields});
  return "updated";
 }
 await request(t,path,"POST",{fields});
 return "created";
}
async function upsertGmail(t,m){
 if(!m?.id)throw Error("Gmail message ID required");
 const matches=await findBy(t,CONTACTS,"数据来源ID","gmail:"+m.id);
 if(matches.length>1)throw Error("Duplicate Gmail message in Feishu");
 const fields={
  "沟通记录编号":"gmail:"+m.id,
  "数据来源ID":"gmail:"+m.id,
  "Gmail线程ID":m.threadId||"",
  "邮件主题":m.subject||"",
  "客户邮箱":m.customerEmail||"",
  "沟通渠道":"Gmail",
  "记录时间":new Date(m.date).getTime(),
  "原邮件链接":{text:"查看 Gmail",link:"https://mail.google.com/mail/u/0/#all/"+m.threadId},
  "最后同步时间":Date.now()
 };
 // Do not create speculative intent, psychology, customer grade, or service status.
 const path="/bitable/v1/apps/"+APP+"/tables/"+CONTACTS+"/records";
 if(matches.length){await request(t,path+"/"+matches[0].record_id,"PUT",{fields});return "updated";}
 await request(t,path,"POST",{fields});return "created";
}
module.exports={tenantToken,findBy,upsertCustomer,upsertGmail};
