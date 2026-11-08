"use strict";
const crypto=require("crypto");
const {get,put}=require("@vercel/blob");
const {mark}=require("../lib/crm-task-log");
const gmail=require("../lib/crm-gmail");
const feishu=require("../lib/crm-feishu");
const bulk=require("../lib/crm-bulk-feishu");
const PATH="crm-execution/gmail-filtered-cursor.json";
const EMAIL_CACHE="crm-execution/gmail-verified-email-index-v1.json";
const EMAIL_CACHE_MS=30*60*1000;
const SINCE="2025-11-08T00:00:00.000Z";
function authorized(req){
 const expected=Buffer.from(process.env.CRON_SECRET||"");
 const given=Buffer.from((req.headers.authorization||"").replace(/^Bearer\s+/i,""));
 return !!expected.length&&expected.length===given.length&&crypto.timingSafeEqual(given,expected);
}
async function readState(){
 const r=await get(PATH,{access:"private"});
 if(!r||r.statusCode!==200)return {};
 const b=[];for await(const x of r.stream)b.push(x);
 return JSON.parse(Buffer.concat(b).toString("utf8"));
}
async function saveState(x){
 x.updatedAt=new Date().toISOString();
 await put(PATH,JSON.stringify(x),{access:"private",addRandomSuffix:false,allowOverwrite:true,contentType:"application/json"});
}
async function emailIndex(token){
 const cached=await get(EMAIL_CACHE,{access:"private"});
 if(cached?.statusCode===200){
  const chunks=[];for await(const c of cached.stream)chunks.push(c);
  const data=JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if(Date.now()-Number(data.createdAt)<EMAIL_CACHE_MS&&Array.isArray(data.entries))
   return new Map(data.entries);
 }
 const map=new Map(); let cursor;
 const base="https://open.feishu.cn/open-apis/bitable/v1/apps/Y7VvbgreAasoLtsYdhrcmmDUn5d/tables/"+bulk.CUSTOMERS+"/records";
 for(let n=0;n<100;n++){
  const url=new URL(base);url.searchParams.set("page_size","500");if(cursor)url.searchParams.set("page_token",cursor);
  const res=await fetch(url,{headers:{Authorization:"Bearer "+token}});
  const j=await res.json().catch(()=>({}));
  if(!res.ok||j.code!==0)throw Error("Failed reading customer email index");
  for(const item of j.data?.items||[]){
   const state=item.fields?.["客户数据状态"];
   const quality=typeof state==="string"?state:Array.isArray(state)?state.map(x=>x.text||"").join(""):"";
   if(quality&&quality!=="有效")continue;
   const raw=item.fields?.["邮箱"];const value=typeof raw==="string"?raw:Array.isArray(raw)?raw.map(t=>t.text||"").join(""):"";
   const email=value.trim().toLowerCase();
   if(email)map.set(email,(map.get(email)||0)+1);
  }
  if(!j.data?.has_more)break;
  cursor=j.data?.page_token;if(!cursor)throw Error("Missing Bitable customer page token");
 }
 await put(EMAIL_CACHE,JSON.stringify({createdAt:Date.now(),entries:[...map]}),{access:"private",addRandomSuffix:false,allowOverwrite:true,contentType:"application/json"});
 return map;
}
async function append(token,records){
 if(!records.length)return 0;
 const path="/bitable/v1/apps/Y7VvbgreAasoLtsYdhrcmmDUn5d/tables/"+bulk.THREADS+"/records/batch_create";
 const data=await bulk.request(token,path,"POST",{records});
 if((data.records||[]).length!==records.length)throw Error("Incomplete Gmail Feishu batch create");
 return records.length;
}
module.exports=async(req,res)=>{
 res.setHeader("Cache-Control","no-store");
 if(req.method!=="GET")return res.status(405).json({ok:false});
 if(!authorized(req))return res.status(401).json({ok:false});
 if(process.env.CRM_FILTER_VERSION!=="v2-reviewed")return res.status(200).json({ok:true,paused:true,reason:"Awaiting valid customer screening and subscriptions fields"});
 if(!(process.env.GMAIL_CLIENT_ID&&process.env.GMAIL_CLIENT_SECRET&&process.env.GMAIL_REFRESH_TOKEN))
  return res.status(200).json({ok:true,skipped:"gmail_oauth_not_configured"});
 const stats={seen:0,accepted:0,excluded_categories:0,excluded_auto:0,unmatched:0,ambiguous:0,duplicate_threads:0,created:0,pages:0};
 try{
  const state=await readState();
  // Gmail imports are intentionally sequential after Shopify customer backfill.
  const base=await get("crm-execution/import-cursor.json",{access:"private"});
  if(!base||base.statusCode!==200)return res.status(200).json({ok:true,skipped:"shopify_backfill_not_started"});
  const bytes=[];for await(const c of base.stream)bytes.push(c);
  const shop=JSON.parse(Buffer.concat(bytes).toString("utf8"));
  if(!shop.shopifyCycleComplete)return res.status(200).json({ok:true,skipped:"awaiting_shopify_backfill",shopifyProcessed:shop.shopifyTotals?.processed||0});
  if(state.finished){await mark("T07","done","Gmail filtered historical correspondence completed");return res.status(200).json({ok:true,completed:true,totals:state.totals});}
  const token=await feishu.tenantToken();
  const emails=await emailIndex(token);
  const existing=await bulk.loadIndex(token,bulk.THREADS,"数据来源ID");
  const gmailToken=await gmail.token();
  const pages=Math.min(3,Math.max(1,Number(req.query?.pages)||2));
  for(let n=0;n<pages;n++){
   const list=await gmail.listMessages(gmailToken,{pageToken:state.pageToken||undefined,maxResults:40,after:SINCE});
   const additions=[],addedIds=new Set();
   const countersBefore={...stats};
   for(const row of list.messages||[]){
    stats.seen++;
    const m=await gmail.message(gmailToken,row.id);
    const reason=gmail.classifyMessage(m);
    if(reason!=="candidate"){
     if(reason==="category_excluded")stats.excluded_categories++;
     else stats.excluded_auto++;
     continue;
    }
    const compact=gmail.compactMessage(m);
    const matches=emails.get(compact.from)||0;
    if(!matches){stats.unmatched++;continue;}
    if(matches>1){stats.ambiguous++;continue;}
    const key="gmail:thread:"+m.threadId;
    if(existing.has(key)||addedIds.has(key)){stats.duplicate_threads++;continue;}
    // Store one direct human incoming customer message per Gmail thread.
    additions.push({fields:{
      "沟通记录编号":key,"数据来源ID":key,
      "Gmail线程ID":m.threadId,
      "客户邮箱":compact.from,
      "邮件主题":compact.subject,
      "沟通渠道":"Gmail",
      "记录时间":new Date(compact.date).getTime(),
      "原邮件链接":{text:"Gmail线程",link:"https://mail.google.com/mail/u/0/#all/"+m.threadId},
      "最后同步时间":Date.now()
    }});
    addedIds.add(key);stats.accepted++;
   }
   const created=await append(token,additions);
   stats.created+=created;stats.pages++;
   for(const id of addedIds)existing.set(id,"created");
   state.totals=state.totals||{seen:0,created:0,excluded_categories:0,excluded_auto:0,unmatched:0,ambiguous:0,duplicate_threads:0,pages:0};
   for(const key of Object.keys(state.totals)){
    const current=stats[key]||0;
    state.totals[key]+=current-(countersBefore[key]||0);
   }
   // Reset per-page counters to prevent cumulative overcount on subsequent pages.
   state.pageToken=list.nextPageToken||null;state.finished=!list.nextPageToken;
   await saveState(state);
   if(state.finished)break;
  }
  await mark("T07",state.finished?"done":"in_progress","Filtered Gmail threads imported "+(state.totals?.created||0));
  return res.status(200).json({ok:true,completed:!!state.finished,run:stats,totals:state.totals||{},criteria:"Gmail 365-day window, non-promotional, non-automated, direct inbound matched unique Shopify customer, one record per thread"});
 }catch(e){await mark("T07","retry",String(e.message||e).slice(0,140));return res.status(502).json({ok:false,error:String(e.message).slice(0,180),stats,retryable:true});}
};
