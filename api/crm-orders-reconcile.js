"use strict";
// Reconcile only after BOTH Shopify customer and full order snapshots complete.
// Idempotent in-place batch updates: never create or delete CRM customer rows.
const crypto=require("crypto");
const {get,put}=require("@vercel/blob");
const feishu=require("../lib/crm-feishu");
const bulk=require("../lib/crm-bulk-feishu");
const {summarize,customerValues}=require("../lib/crm-order-aggregate");
const STATE="crm-execution/orders-reconcile-state.json";
const MANIFEST="crm-execution/orders-reconcile-manifest.json";
function authorized(req){
 const a=Buffer.from((req.headers.authorization||"").replace(/^Bearer\s+/i,""));
 const b=Buffer.from(process.env.CRON_SECRET||"");
 return !!b.length&&a.length===b.length&&crypto.timingSafeEqual(a,b);
}
async function read(path){
 const r=await get(path,{access:"private"});if(!r||r.statusCode!==200)return null;
 const chunks=[];for await(const c of r.stream)chunks.push(c);
 return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
async function save(path,data){
 await put(path,JSON.stringify(data),{access:"private",addRandomSuffix:false,allowOverwrite:true,contentType:"application/json"});
}
function val(v){
 if(typeof v==="string"||typeof v==="number")return v;
 if(Array.isArray(v))return v.map(x=>x.text||"").join("");
 return null;
}
async function feishuRows(token){
 const result=[],seen=new Set();let cursor;
 const base="/bitable/v1/apps/Y7VvbgreAasoLtsYdhrcmmDUn5d/tables/"+bulk.CUSTOMERS+"/records";
 for(let i=0;i<100;i++){
  const u=new URL("https://open.feishu.cn/open-apis"+base);u.searchParams.set("page_size","500");if(cursor)u.searchParams.set("page_token",cursor);
  const r=await fetch(u,{headers:{Authorization:"Bearer "+token}}),j=await r.json().catch(()=>({}));
  if(!r.ok||j.code!==0)throw Error("Feishu customer list failed");
  for(const item of j.data?.items||[]){
   const f=item.fields||{},id=String(val(f["Shopify客户ID"])||"");
   if(!id.startsWith("gid://shopify/Customer/"))continue;
   if(seen.has(id))throw Error("Duplicate Shopify Customer ID: manual resolution needed");
   seen.add(id);
   const rawOrders=val(f["历史订单数"]);
   result.push({record_id:item.record_id,id,lifetimeOrders:rawOrders===null?NaN:Number(rawOrders),lastOrderAt:val(f["最近下单日期"])});
  }
  if(!j.data?.has_more)break;
  cursor=j.data.page_token;if(!cursor)throw Error("Feishu cursor missing");
 }
 return result;
}
module.exports=async(req,res)=>{
 res.setHeader("Cache-Control","no-store");
 if(req.method!=="GET")return res.status(405).json({ok:false});
 if(!authorized(req))return res.status(401).json({ok:false});
 try{
  const [orders,customers]=await Promise.all([read("crm-execution/orders-stage-state.json"),read("crm-execution/import-cursor.json")]);
  if(!orders?.completed||!customers?.shopifyCycleComplete)return res.status(200).json({ok:true,waiting:true,orders_complete:!!orders?.completed,customers_complete:!!customers?.shopifyCycleComplete});
  if(orders.totals?.unknown_currency)return res.status(200).json({ok:true,waiting:true,reason:"unverified_non_usd_order_values",count:orders.totals.unknown_currency});
  const state=await read(STATE)||{offset:0,done:false};
  if(state.done)return res.status(200).json({ok:true,completed:true,totals:state.totals});
  let manifest=await read(MANIFEST);
  if(!manifest){
   const all=[];
   for(let i=0;i<orders.page;i++){
    const page=await read("crm-execution/orders-stage/page-"+i+".json");
    if(!page||!Array.isArray(page.orders))throw Error("Missing committed order snapshot page "+i);
    all.push(...page.orders);
   }
   const summaries=summarize(all),token=await feishu.tenantToken();
   const rows=await feishuRows(token),updates=[];
   const asOf=new Date(orders.startedAt);
   for(const c of rows){
    const values=customerValues(c,summaries.get(c.id),{now:asOf});
    const fields={"CRM等级":values.grade};
    if(Number.isFinite(values.m))fields["近180天净消费"]=values.m;
    if(Number.isFinite(values.f))fields["近180天有效订单数"]=values.f;
    if(values.r!==null)fields["最近购买距今天数R"]=values.r;
    if(values.rfm)fields["RFM价值分群"]=values.rfm;
    updates.push({record_id:c.record_id,fields});
   }
   manifest={updates,source_since:orders.since,source_pages:orders.page,created_at:new Date().toISOString()};
   await save(MANIFEST,manifest);
  }
  const token=await feishu.tenantToken();
  const batch=manifest.updates.slice(state.offset,state.offset+500);
  if(batch.length){
   const result=await bulk.request(token,"/bitable/v1/apps/Y7VvbgreAasoLtsYdhrcmmDUn5d/tables/"+bulk.CUSTOMERS+"/records/batch_update","POST",{records:batch});
   if((result.records||[]).length!==batch.length)throw Error("Incomplete Feishu CRM grade update");
   state.offset+=batch.length;
  }
  state.done=state.offset>=manifest.updates.length;
  state.updatedAt=new Date().toISOString();
  state.totals={updated:state.offset,expected:manifest.updates.length,orders:orders.totals?.eligible||0};
  await save(STATE,state);
  return res.status(200).json({ok:true,completed:state.done,totals:state.totals,source_since:manifest.source_since});
 }catch(e){return res.status(502).json({ok:false,retryable:true,error:String(e.message||e).slice(0,180)});}
};
