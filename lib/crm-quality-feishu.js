"use strict";
const API="https://open.feishu.cn/open-apis";
const APP="Y7VvbgreAasoLtsYdhrcmmDUn5d";
const TABLE="tblbk7Ju6fcM1BXF";
const {classify}=require("./crm-customer-quality");
async function api(token,path,method="GET",body){
 const response=await fetch(API+path,{method,headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},...(body?{body:JSON.stringify(body)}:{})});
 const j=await response.json().catch(()=>({}));
 if(!response.ok||j.code!==0)throw Error("Feishu API "+String(j.code||response.status)+" "+String(j.msg||"").slice(0,120));
 return j.data||{};
}
async function ensureFields(token){
 const path="/bitable/v1/apps/"+APP+"/tables/"+TABLE+"/fields";
 const d=await api(token,path+"?page_size=100");
 const names=new Set((d.items||[]).map(x=>x.field_name));
 const required=[
  {field_name:"邮件订阅状态",type:3,property:{options:["已订阅","未订阅","已退订","待确认","邮箱无效"].map(name=>({name}))}},
  {field_name:"客户数据状态",type:3,property:{options:["有效","待核验"].map(name=>({name}))}}
 ];
 const created=[];
 for(const field of required)if(!names.has(field.field_name)){await api(token,path,"POST",field);created.push(field.field_name);}
 return created;
}
function text(v){
 if(typeof v==="string")return v;
 if(Array.isArray(v))return v.map(x=>x.text||"").join("");
 return "";
}
async function cleanExisting(token,state,maxPages=30){
 if(state.qualityCleanupFinished)return {finished:true,scanned:0,removed:0,flaggedPaid:0};
 const base="/bitable/v1/apps/"+APP+"/tables/"+TABLE+"/records";
 let pageToken,scanned=0,removed=0,flaggedPaid=0,flagged=0;
 // Iterate over a fixed snapshot by collecting IDs first, then deleting, to avoid index shifts.
 const toDelete=[];
 for(let i=0;i<maxPages;i++){
  const u=new URL(API+base);u.searchParams.set("page_size","500");
  if(pageToken)u.searchParams.set("page_token",pageToken);
  const r=await fetch(u,{headers:{Authorization:"Bearer "+token}});
  const d=await r.json().catch(()=>({}));
  if(!r.ok||d.code!==0)throw Error("Feishu cleanup scan failed");
  for(const x of d.data?.items||[]){
   const f=x.fields||{};
   const id=text(f["Shopify客户ID"]);
   if(!id){
    if(!Object.values(f).some(v=>v!=null&&v!==""&&(!Array.isArray(v)||v.length)))toDelete.push(x.record_id);
    continue;
   }
   scanned++;
   const name=text(f["客户姓名"]);
   const parts=name.split(/\s+/);
   const c={id,firstName:parts[0]||"",lastName:parts.slice(1).join(" "),
    numberOfOrders:typeof f["历史订单数"]==="number"?f["历史订单数"]:0,
    defaultEmailAddress:{emailAddress:text(f["邮箱"]),marketingState:"SUBSCRIBED"}};
   const result=classify(c);
   if(!result.eligible){
    flagged++;
    if(result.paidManualReview)flaggedPaid++;
    toDelete.push(x.record_id);
   }
  }
  if(!d.data?.has_more)break;
  pageToken=d.data.page_token;if(!pageToken)throw Error("Cleanup scan pagination missing");
 }
 for(let i=0;i<toDelete.length;i+=100){
  const ids=toDelete.slice(i,i+100);
  await api(token,base+"/batch_delete","POST",{records:ids});
  removed+=ids.length;
 }
 // Batches are idempotent; resume by scanning current CRM contents on next run.
 state.qualityCleanupFinished=true;
 state.qualityAudit=state.qualityAudit||{};
 state.qualityAudit.existingRemoved=(state.qualityAudit.existingRemoved||0)+removed;
 state.qualityAudit.existingFlaggedPaid=(state.qualityAudit.existingFlaggedPaid||0)+flaggedPaid;
 return {finished:true,scanned,flagged,removed,flaggedPaid};
}
module.exports={ensureFields,cleanExisting};
