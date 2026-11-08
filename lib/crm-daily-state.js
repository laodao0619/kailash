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
function cycle(state,now=new Date()){
 const today=now.toISOString().slice(0,10);
 if(state&&!state.completed)return state;
 if(state?.completed&&String(state.day)===today)return state;
 const latest=state?.completedAt?Date.parse(state.completedAt):NaN;
 const last=Number.isFinite(latest)?latest:now.getTime()-48*HOUR;
 const cutoff=new Date(Math.min(last-HOUR,now.getTime()-HOUR)).toISOString();
 return {version:1,day:today,windowStart:cutoff,cursor:null,completed:false,startedAt:now.toISOString(),
  counters:{scanned:0,accepted:0,excluded:0,created:0,updated:0,duplicates:0,pages:0}};
}
function shouldContinue(state){return !state.completed;}
function done(state,now=new Date()){
 state.completed=true;state.completedAt=now.toISOString();state.cursor=null;
 return state;
}
module.exports={ROOT,authorized,read,save,cycle,shouldContinue,done};
