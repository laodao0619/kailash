"use strict";
const crypto=require("crypto");
const {get,put}=require("@vercel/blob");
const shopify=require("../lib/crm-shopify");
const gmail=require("../lib/crm-gmail");
const feishu=require("../lib/crm-feishu");
const PATH="crm-execution/import-cursor.json";
function authed(req){
 const expected=process.env.CRON_SECRET||"";
 const supplied=(req.headers.authorization||"").replace(/^Bearer\s+/i,"");
 const x=Buffer.from(expected),y=Buffer.from(supplied);
 return x.length>0&&x.length===y.length&&crypto.timingSafeEqual(x,y);
}
async function readCursor(){
 const r=await get(PATH,{access:"private"});
 if(!r||r.statusCode!==200)return {};
 const bytes=[];for await(const c of r.stream)bytes.push(c);
 return JSON.parse(Buffer.concat(bytes).toString("utf8"));
}
async function save(cursor){
 await put(PATH,JSON.stringify(cursor),{access:"private",addRandomSuffix:false,allowOverwrite:true,contentType:"application/json"});
}
module.exports=async(req,res)=>{
 res.setHeader("Cache-Control","no-store");
 if(req.method!=="GET")return res.status(405).json({ok:false});
 if(!authed(req))return res.status(401).json({ok:false});
 const readyShop=!!(process.env.SHOPIFY_ADMIN_ACCESS_TOKEN&&process.env.SHOPIFY_SHOP_DOMAIN);
 const readyGmail=!!(process.env.GMAIL_REFRESH_TOKEN&&process.env.GMAIL_CLIENT_ID&&process.env.GMAIL_CLIENT_SECRET);
 if(!readyShop&&!readyGmail)return res.status(200).json({ok:true,skipped:"waiting_for_shopify_and_gmail_backend_authorization",shopify:false,gmail:false});
 const stat={shopify:{processed:0,created:0,updated:0,failed:0},gmail:{processed:0,created:0,updated:0,failed:0}};
 try{
  const t=await feishu.tenantToken();
  let cursor=await readCursor();
  if(readyShop){
   for(let n=0;n<3;n++){
    const page=await shopify.customers(cursor.shopifyCursor||null);
    for(const customer of page.nodes||[]){
     try{const result=await feishu.upsertCustomer(t,customer);stat.shopify[result]++;stat.shopify.processed++;}
     catch(e){stat.shopify.failed++;throw new Error("Shopify Feishu upsert failed; retry same page next run");}
    }
    cursor.shopifyCursor=page.pageInfo?.hasNextPage?page.pageInfo.endCursor:null;
    cursor.shopifyCycleComplete=!page.pageInfo?.hasNextPage;
    cursor.updatedAt=new Date().toISOString();
    await save(cursor);
    if(cursor.shopifyCycleComplete)break;
   }
  }
  if(readyGmail){
   const tkn=await gmail.token();
   for(let n=0;n<2;n++){
    const list=await gmail.listMessages(tkn,{pageToken:cursor.gmailNextPageToken||undefined,maxResults:50});
    for(const msg of list.messages||[]){
     try{
      const item=await gmail.message(tkn,msg.id);
      const record=gmail.compactMessage(item);
      const result=await feishu.upsertGmail(t,record);
      stat.gmail[result]++;stat.gmail.processed++;
     }catch(e){stat.gmail.failed++;throw new Error("Gmail Feishu upsert failed; retry same page next run");}
    }
    cursor.gmailNextPageToken=list.nextPageToken||null;
    cursor.gmailCycleComplete=!list.nextPageToken;
    cursor.updatedAt=new Date().toISOString();
    await save(cursor);
    if(cursor.gmailCycleComplete)break;
   }
  }
  return res.status(200).json({ok:true,stats:stat,shopify_cycle_complete:cursor.shopifyCycleComplete||false,gmail_cycle_complete:cursor.gmailCycleComplete||false,
  caution:"Imported raw source fields only. Customer RFM classification requires validated 180-day order rollup."});
 }catch(e){
  return res.status(502).json({ok:false,error:String(e.message).slice(0,180),stats:stat,retryable:true});
 }
};
