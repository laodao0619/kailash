"use strict";
const API="https://open.feishu.cn/open-apis";
const APP="Y7VvbgreAasoLtsYdhrcmmDUn5d";
const CUSTOMERS="tblbk7Ju6fcM1BXF";
const THREADS="tblNi7C5q5FYlG06";
const {classify}=require("./crm-customer-quality");
async function request(token,path,method="GET",body){
 const r=await fetch(API+path,{method,headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},...(body?{body:JSON.stringify(body)}:{})});
 const j=await r.json().catch(()=>({}));
 if(!r.ok||j.code!==0)throw new Error("Feishu API "+(j.code||r.status)+" "+String(j.msg||"").slice(0,140));
 return j.data||{};
}
async function loadIndex(token,table,field){
 const index=new Map();
 let pageToken;
 for(let page=0;page<100;page++){
  const u=new URL(API+"/bitable/v1/apps/"+APP+"/tables/"+table+"/records");
  u.searchParams.set("page_size","500");
  if(pageToken)u.searchParams.set("page_token",pageToken);
  const r=await fetch(u,{headers:{Authorization:"Bearer "+token}});
  const j=await r.json().catch(()=>({}));
  if(!r.ok||j.code!==0)throw new Error("Feishu record index failed "+String(j.msg||""));
  for(const item of j.data?.items||[]){
   const v=item.fields?.[field];
   const id=typeof v==="string"?v:Array.isArray(v)?v.map(x=>x.text||"").join(""):"";
   if(id){
    if(index.has(id))throw new Error("Duplicate CRM unique ID in existing records: manual resolution required");
    index.set(id,item.record_id);
   }
  }
  if(!j.data?.has_more)break;
  if(!j.data?.page_token)throw Error("Feishu pagination missing token");
  pageToken=j.data.page_token;
 }
 return index;
}
function customerFields(c){
 if(!c?.id)throw Error("Missing Shopify customer ID");
 const fields={
  "客户唯一编号":String(c.id).split("/").pop(),
  "Shopify客户ID":c.id,
  "客户姓名":[c.firstName,c.lastName].filter(Boolean).join(" "),
  "邮箱":c.defaultEmailAddress?.emailAddress?.trim().toLowerCase()||"",
  "国家地区":c.defaultAddress?.country||"",
  "历史订单数":Number(c.numberOfOrders)||0,
  "邮件订阅状态":classify(c).subscription,
  "客户数据状态":"有效",
  "数据最后同步时间":Date.now()
 };
 if(c.lastOrder?.processedAt){
  const last=new Date(c.lastOrder.processedAt).getTime();
  if(Number.isFinite(last))fields["最近下单日期"]=last;
 }
 const firstOrder=c.orders?.nodes?.[0];
 if(firstOrder?.processedAt&&!firstOrder.test){
  const first=new Date(firstOrder.processedAt).getTime();
  if(Number.isFinite(first))fields["首次下单时间"]=first;
 }
 const consent=c.defaultEmailAddress;
 if(consent?.marketingUpdatedAt){
  const updated=new Date(consent.marketingUpdatedAt).getTime();
  if(Number.isFinite(updated))fields["订阅状态更新时间"]=updated;
  const created=new Date(c.createdAt).getTime();
  // Shopify gives the most recent consent-change time, not a guaranteed
  // historical first opt-in. Only infer first opt-in when recorded at signup.
  if(consent.marketingState==="SUBSCRIBED"&&Number.isFinite(updated)&&Number.isFinite(created)&&Math.abs(updated-created)<=60000)
   fields["首次订阅时间"]=updated;
 }
 if(c.amountSpent?.currencyCode==="USD"&&Number.isFinite(Number(c.amountSpent.amount)))
  fields["历史累计消费"]=Number(c.amountSpent.amount);
 return fields;
}
function milestoneFields(c){
 const all=customerFields(c),fields={};
 for(const name of ["首次订阅时间","首次下单时间","订阅状态更新时间"])
  if(Number.isFinite(all[name]))fields[name]=all[name];
 return fields;
}
async function batchCustomers(token,customers,index){
 const path="/bitable/v1/apps/"+APP+"/tables/"+CUSTOMERS+"/records";
 const creates=[],updates=[];
 for(const c of customers){
  const fields=customerFields(c);
  const existing=index.get(c.id);
  if(existing)updates.push({record_id:existing,fields});
  else creates.push({fields});
 }
 let created=0,updated=0;
 for(const [part,items] of [["batch_update",updates],["batch_create",creates]]){
  if(!items.length)continue;
  const result=await request(token,path+"/"+part,"POST",{records:items});
  const returned=result.records||[];
  if(returned.length!==items.length)throw Error("Feishu "+part+" returned incomplete result");
  if(part==="batch_update")updated+=items.length;
  else{
   created+=items.length;
   for(let i=0;i<items.length;i++)index.set(items[i].fields["Shopify客户ID"],returned[i].record_id);
  }
 }
 return {created,updated};
}
module.exports={request,loadIndex,batchCustomers,milestoneFields,CUSTOMERS,THREADS};
