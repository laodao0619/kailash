"use strict";
// Pre-screen historical Gmail independently of the Shopify customer backfill.
// This stage never writes customer correspondence to Feishu and never sends mail.
const crypto=require("crypto");
const {get,put}=require("@vercel/blob");
const gmail=require("../lib/crm-gmail");
const STATE_PATH="crm-execution/gmail-stage-state.json";
const SINCE="2025-11-08T00:00:00.000Z";
function authorized(req){
 const expected=Buffer.from(process.env.CRON_SECRET||"");
 const given=Buffer.from((req.headers.authorization||"").replace(/^Bearer\s+/i,""));
 return !!expected.length&&expected.length===given.length&&crypto.timingSafeEqual(expected,given);
}
async function read(path){
 const r=await get(path,{access:"private"});
 if(!r||r.statusCode!==200)return null;
 const parts=[];for await(const x of r.stream)parts.push(x);
 return JSON.parse(Buffer.concat(parts).toString("utf8"));
}
async function save(path,value){
 await put(path,JSON.stringify(value),{access:"private",addRandomSuffix:false,allowOverwrite:true,contentType:"application/json"});
}
module.exports=async(req,res)=>{
 res.setHeader("Cache-Control","no-store");
 if(req.method!=="GET")return res.status(405).json({ok:false});
 if(!authorized(req))return res.status(401).json({ok:false});
 if(process.env.CRM_FILTER_VERSION!=="v2-reviewed")return res.status(200).json({ok:true,paused:true,reason:"customer_quality_review_required"});
 if(!(process.env.GMAIL_CLIENT_ID&&process.env.GMAIL_CLIENT_SECRET&&process.env.GMAIL_REFRESH_TOKEN))return res.status(200).json({ok:true,paused:true,reason:"gmail_oauth_missing"});
 try{
  const state=await read(STATE_PATH)||{page:0,pageToken:null,completed:false,totals:{scanned:0,candidates:0,excluded:0}};
  if(state.completed)return res.status(200).json({ok:true,completed:true,totals:state.totals});
  const token=await gmail.token();
  const start=Date.now(),maxPages=4;
  let processed=0;
  for(let i=0;i<maxPages&&Date.now()-start<85000;i++){
   const result=await gmail.listMessages(token,{pageToken:state.pageToken||undefined,maxResults:50,after:SINCE});
   const candidates=[];
   for(const item of result.messages||[]){
    const m=await gmail.message(token,item.id);
    state.totals.scanned++;
    if(gmail.classifyMessage(m)!=="candidate"){state.totals.excluded++;continue;}
    const c=gmail.compactMessage(m);
    candidates.push({threadId:c.threadId,from:c.from,subject:c.subject,date:c.date});
    state.totals.candidates++;
   }
   // Commit the private candidate page before advancing the cursor.
   await save("crm-execution/gmail-stage/page-"+state.page+".json",{candidates});
   state.page++;
   state.pageToken=result.nextPageToken||null;
   state.completed=!result.nextPageToken;
   state.updatedAt=new Date().toISOString();
   await save(STATE_PATH,state);
   processed++;
   if(state.completed)break;
  }
  return res.status(200).json({ok:true,phase:"gmail_prescreen",completed:state.completed,pages_this_run:processed,pages_total:state.page,totals:state.totals,note:"Private candidate list only; Feishu import remains gated on complete Shopify customer index"});
 }catch(e){return res.status(502).json({ok:false,retryable:true,error:String(e.message||e).slice(0,180)});}
};
