"use strict";
const API="https://open.feishu.cn/open-apis";
const APP="Y7VvbgreAasoLtsYdhrcmmDUn5d",TABLE="tblbk7Ju6fcM1BXF";
const views=[
 {name:"01｜客户工作台",show:["客户唯一编号","客户姓名","邮箱","国家地区","邮件订阅状态","CRM等级","历史订单数","历史累计消费","最近下单日期","客户数据状态"]},
 {name:"02｜已订阅客户",show:["客户唯一编号","客户姓名","邮箱","国家地区","邮件订阅状态","CRM等级","历史订单数","历史累计消费","最近下单日期"],filter:["已订阅"]},
 {name:"03｜非订阅客户",show:["客户唯一编号","客户姓名","邮箱","国家地区","邮件订阅状态","CRM等级","历史订单数","历史累计消费","最近下单日期"],filter:["未订阅","已退订","待确认"]}
];
async function api(token,path,method="GET",data){
 const r=await fetch(API+path,{method,headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},...(data?{body:JSON.stringify(data)}:{})});
 const x=await r.json().catch(()=>({}));
 if(!r.ok||x.code!==0)throw Error("CRM view "+(x.code||r.status)+" "+String(x.msg||"").slice(0,160));
 return x.data||{};
}
async function organizeViews(token){
 const base="/bitable/v1/apps/"+APP+"/tables/"+TABLE;
 const [f,v]=await Promise.all([api(token,base+"/fields?page_size=100"),api(token,base+"/views?page_size=100")]);
 const fields=f.items||[],byName=new Map(fields.map(x=>[x.field_name,x.field_id]));
 const marketingId=byName.get("邮件订阅状态");
 const options=(fields.find(x=>x.field_name==="邮件订阅状态")?.property?.options||[]);
 const marketingOptions=new Map(options.map(x=>[x.name,x.id]));
 if(!marketingId)throw Error("CRM subscription field missing");
 const oldViews=new Map((v.items||[]).map(x=>[x.view_name,x.view_id]));
 const outcomes=[];
 for(const spec of views){
  let id=oldViews.get(spec.name),created=false;
  if(!id){
   const d=await api(token,base+"/views","POST",{view_name:spec.name,view_type:"grid"});
   id=(d.view||d).view_id;
   if(!id)throw Error("Feishu did not return new view id");
   created=true;
  }
  const show=new Set(spec.show);
  const hidden_fields=fields.filter(x=>!show.has(x.field_name)&&!x.is_primary).map(x=>x.field_id);
  const property={hidden_fields};
  if(spec.filter){
   property.filter_info={conjunction:"or",conditions:spec.filter.map(value=>({field_id:marketingId,operator:"is",value:JSON.stringify([marketingOptions.get(value)||value])}))};
  }
  try{
   await api(token,base+"/views/"+id,"PATCH",{property});
   outcomes.push({name:spec.name,created,configured:true,visible_fields:spec.show.length});
  }catch(e){
   // Never leave a newly-created subscription view visible without its filter.
   if(created){try{await api(token,base+"/views/"+id,"DELETE");}catch{}}
   if(spec.filter)throw Error(spec.name+" filter not installed: "+String(e.message));
   throw e;
  }
 }
 return outcomes;
}
module.exports={organizeViews};
