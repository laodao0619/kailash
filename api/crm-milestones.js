"use strict";
// Second customer pass fills lifecycle milestone dates for records that
// were imported before these fields existed. Never overwrites CRM notes.
const crypto=require("crypto"),{get,put}=require("@vercel/blob");
const shopify=require("../lib/crm-shopify"),feishu=require("../lib/crm-feishu");
const bulk=require("../lib/crm-bulk-feishu"),quality=require("../lib/crm-quality-feishu");
const PATH="crm-execution/milestones-cursor.json";
function authorized(req){
 const a=Buffer.from((req.headers.authorization||"").replace(/^Bearer\s+/i,""));
 const b=Buffer.from(process.env.CRON_SECRET||"");
 return !!b.length&&a.length===b.length&&crypto.timingSafeEqual(a,b);
}
async function stateRead(){
 const x=await get(PATH,{access:"private"});if(!x||x.statusCode!==200)return {};
 const chunks=[];for await(const c of x.stream)chunks.push(c);
 return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
async function stateSave(state){
 state.updatedAt=new Date().toISOString();
 await put(PATH,JSON.stringify(state),{access:"private",addRandomSuffix:false,allowOverwrite:true,contentType:"application/json"});
}
module.exports=async(req,res)=>{
 res.setHeader("Cache-Control","no-store");
 if(req.method!=="GET")return res.status(405).json({ok:false});
 if(!authorized(req))return res.status(401).json({ok:false});
 try{
  const base=await get("crm-execution/import-cursor.json",{access:"private"});
  if(!base||base.statusCode!==200)return res.status(200).json({ok:true,waiting:true,reason:"customer_backfill_not_started"});
  const chunks=[];for await(const c of base.stream)chunks.push(c);
  const imported=JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if(!imported.shopifyCycleComplete)return res.status(200).json({ok:true,waiting:true,reason:"customer_backfill_in_progress"});
  const s=await stateRead();
  if(s.completed)return res.status(200).json({ok:true,completed:true,totals:s.totals});
  const token=await feishu.tenantToken();
  await quality.ensureFields(token);
  const index=await bulk.loadIndex(token,bulk.CUSTOMERS,"Shopify客户ID");
  s.totals=s.totals||{scanned:0,updated:0,first_order:0,first_subscription_verified:0};
  const began=Date.now();
  for(let i=0;i<8&&Date.now()-began<90000;i++){
   const page=await shopify.customers(s.cursor||null,50);
   const batch=[];
   for(const c of page.nodes||[]){
    s.totals.scanned++;
    const record_id=index.get(c.id);if(!record_id)continue;
    const fields=bulk.milestoneFields(c);
    if(!Object.keys(fields).length)continue;
    batch.push({record_id,fields});
    if(fields["首次下单时间"])s.totals.first_order++;
    if(fields["首次订阅时间"])s.totals.first_subscription_verified++;
   }
   if(batch.length){
    const r=await bulk.request(token,"/bitable/v1/apps/Y7VvbgreAasoLtsYdhrcmmDUn5d/tables/"+bulk.CUSTOMERS+"/records/batch_update","POST",{records:batch});
    if((r.records||[]).length!==batch.length)throw Error("Incomplete milestone update");
    s.totals.updated+=batch.length;
   }
   s.cursor=page.pageInfo?.hasNextPage?page.pageInfo.endCursor:null;
   s.completed=!page.pageInfo?.hasNextPage;
   await stateSave(s);
   if(s.completed)break;
  }
  return res.status(200).json({ok:true,completed:!!s.completed,totals:s.totals});
 }catch(e){return res.status(502).json({ok:false,retryable:true,error:String(e.message||e).slice(0,170)});}
};
