"use strict";
/**
 * Daily delta sync state. NEVER resets or rewinds baseline import checkpoints.
 * Private Vercel Blob is used for idempotent, resumable incremental cursors.
 */
const {get,put}=require("@vercel/blob");
const crypto=require("node:crypto");
const ROOT="crm-execution/daily-v1";
const HOUR=3600000;
function authorized(req){
 const expected=process.env.CRON_SECRET||"";
 const value=String(req.headers?.authorization||"").replace(/^Bearer\s+/i,"");
 if(!expected||!value)return false;
 const a=crypto.createHash("sha256").update(expected).digest();
 const b=crypto.createHash("sha256").update(value).digest();
 return crypto.timingSafeEqual(a,b);
}
async function read(path){
 const response=await get(path,{access:"private"});
 if(!response||response.statusCode===404)return null;
 if(response.statusCode!==200)throw Error("Private Blob read failed");
 const parts=[];for await(const c of response.stream)parts.push(c);
 return JSON.parse(Buffer.concat(parts).toString("utf8"));
}
async function save(path,data){
 await put(path,JSON.stringify(data),{access:"private",addRandomSuffix:false,allowOverwrite:true,
  contentType:"application/json"});
}
/**
 * UTC-fixed Vercel cron is interpreted in Beijing time. Shopify store's
 * America/New_York midnight happens at 12:00 BJT in DST, 13:00 in winter;
 * 13:15 BJT is safely past the day boundary year-round.
 */
function beijingSlot(now=new Date()){
 const local=new Date(now.getTime()+8*HOUR);
 const day=local.toISOString().slice(0,10);
 const hour=local.getUTCHours();
 const slot=hour<11?"before_work":hour<15?"after_store_midnight":"before_close";
 return {day,slot,key:day+"/"+slot};
}
function cycle(state,now=new Date()){
 const active=beijingSlot(now);
 // Preserve unfinished work even if a new timeslot starts: never skip pages.
 if(state&&!state.completed)return state;
 // Same Beijing workday slot is already done. New slot may start fresh.
 if(state?.completed&&state.slotKey===active.key)return state;
 const latest=state?.completedAt?Date.parse(state.completedAt):NaN;
 const last=Number.isFinite(latest)?latest:now.getTime()-48*HOUR;
 const cutoff=new Date(Math.min(last-HOUR,now.getTime()-HOUR)).toISOString();
 return {version:2,day:active.day,slot:active.slot,slotKey:active.key,
  windowStart:cutoff,cursor:null,completed:false,startedAt:now.toISOString(),
  counters:{scanned:0,accepted:0,excluded:0,created:0,updated:0,duplicates:0,pages:0}};
}
function shouldContinue(state){return !state.completed;}
function done(state,now=new Date()){
 state.completed=true;state.completedAt=now.toISOString();state.cursor=null;
 return state;
}
module.exports={ROOT,authorized,read,save,beijingSlot,cycle,shouldContinue,done};
