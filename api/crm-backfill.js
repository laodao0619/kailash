"use strict";
const crypto=require("crypto");
const {get,put}=require("@vercel/blob");
const shopify=require("../lib/crm-shopify");
const feishu=require("../lib/crm-feishu");
const bulk=require("../lib/crm-bulk-feishu");
const PATH="crm-execution/import-cursor.json";
function authorized(req){
 const a=Buffer.from((req.headers.authorization||"").replace(/^Bearer\s+/i,""));
 const b=Buffer.from(process.env.CRON_SECRET||"");
 return !!b.length&&a.length===b.length&&crypto.timingSafeEqual(a,b);
}
async function readState(){
 const result=await get(PATH,{access:"private"});
 if(!result||result.statusCode!==200)return {};
 const chunks=[];for await(const c of result.stream)chunks.push(c);
 return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
async function saveState(state){
 state.updatedAt=new Date().toISOString();
 await put(PATH,JSON.stringify(state),{access:"private",addRandomSuffix:false,allowOverwrite:true,contentType:"application/json"});
}
module.exports=async(req,res)=>{
 res.setHeader("Cache-Control","no-store");
 if(req.method!=="GET")return res.status(405).json({ok:false});
 if(!authorized(req))return res.status(401).json({ok:false});
 const ready=!!(process.env.SHOPIFY_SHOP_DOMAIN&&(process.env.SHOPIFY_ADMIN_ACCESS_TOKEN||(process.env.SHOPIFY_CLIENT_ID&&process.env.SHOPIFY_CLIENT_SECRET)));
 if(!ready)return res.status(200).json({ok:true,skipped:"shopify_credentials_unavailable"});
 let state={},stats={new:0,updated:0,pages:0,failed:0};
 try{
  state=await readState();
  if(state.shopifyCycleComplete)return res.status(200).json({ok:true,completed:true,totals:state.shopifyTotals||{},lastUpdate:state.updatedAt});
  const token=await feishu.tenantToken();
  const index=await bulk.loadIndex(token,bulk.CUSTOMERS,"Shopify客户ID");
  // Each page is committed separately. The cursor advances only after its Feishu writes succeed.
  const pages=Math.max(1,Math.min(10,Number(req.query?.pages)||6));
  for(let i=0;i<pages;i++){
   const page=await shopify.customers(state.shopifyCursor||null,50);
   if(!page?.nodes||!page?.pageInfo)throw Error("Shopify customer page malformed");
   if(!page.nodes.length&&!page.pageInfo.hasNextPage){
    state.shopifyCycleComplete=true;
    await saveState(state);
    break;
   }
   const result=await bulk.batchCustomers(token,page.nodes,index);
   stats.new+=result.created;stats.updated+=result.updated;stats.pages++;
   state.shopifyTotals=state.shopifyTotals||{created:0,updated:0,processed:0,pages:0};
   state.shopifyTotals.created+=result.created;
   state.shopifyTotals.updated+=result.updated;
   state.shopifyTotals.processed+=page.nodes.length;
   state.shopifyTotals.pages++;
   state.shopifyCursor=page.pageInfo.hasNextPage?page.pageInfo.endCursor:null;
   state.shopifyCycleComplete=!page.pageInfo.hasNextPage;
   await saveState(state);
   if(state.shopifyCycleComplete)break;
  }
  return res.status(200).json({ok:true,completed:!!state.shopifyCycleComplete,run:stats,totals:state.shopifyTotals||{},note:"Only Shopify customer source fields imported. RFM requires order reconciliation."});
 }catch(e){
  stats.failed++;
  return res.status(502).json({ok:false,retryable:true,run:stats,error:String(e.message||e).slice(0,220)});
 }
};