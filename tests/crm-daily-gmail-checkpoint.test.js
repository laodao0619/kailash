"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),{mock}=require("node:test");
const handler=require("../api/crm-daily-gmail");
const state=require("../lib/crm-daily-state"),gmail=require("../lib/crm-gmail"),feishu=require("../lib/crm-feishu");
function res(){return{code:200,body:null,setHeader(){},status(n){this.code=n;return this;},json(v){this.body=v;return this;}};}
function setup({pages,failOnce=null,repeatCursor=false,messageIdOverride=null,compactIdOverride=null,failSaveOnceAtOffset=null}={}){
 const restores=[],stored={},seen=new Set(),actions=[];
 const spy=(obj,k,fn)=>{const s=mock.method(obj,k,fn);restores.push(s);return s;};
 spy(state,"authorized",()=>true);
 spy(state,"read",async p=>p.includes("gmail-filtered-cursor")?{finished:true}:p.includes("import-cursor")?{shopifyCycleComplete:true}:structuredClone(stored[p]||null));
 let pendingSaveFailure=failSaveOnceAtOffset;
 spy(state,"save",async(p,v)=>{
  if(pendingSaveFailure!==null&&v.pendingPage?.offset===pendingSaveFailure){
   pendingSaveFailure=null;actions.push({type:"save-failed",offset:v.pendingPage.offset});
   throw Error("Synthetic private checkpoint write failure");
  }
  stored[p]=structuredClone(v);actions.push({type:"save",offset:v.pendingPage?.offset,cursor:v.cursor,complete:v.completed});
 });
 spy(gmail,"token",async()=>"g");
 spy(feishu,"tenantToken",async()=>"f");
 spy(gmail,"listMessages",async(_t,a)=>{
  const i=a.pageToken?Number(a.pageToken.slice(1)):0;
  const ids=pages[i]||[];
  assert.equal(a.maxResults,6);
  actions.push({type:"list",i});
  return{messages:ids.map(id=>({id})),nextPageToken:repeatCursor?a.pageToken:(i<pages.length-1?"p"+(i+1):null)};
 });
 let fail=failOnce;
 spy(gmail,"message",async(_t,id)=>{
  actions.push({type:"message",id});
  if(fail===id){fail=null;throw Error("Gmail request failed: 403");}
  return{id:messageIdOverride?.[id]||id,from:"synthetic@example.invalid"};
 });
 spy(gmail,"classifyMessage",()=>"candidate");
 spy(gmail,"compactMessage",m=>({...m,id:compactIdOverride?.[m.id]||m.id}));
 spy(feishu,"findBy",async(_t,_table,field,val)=>field==="邮箱"?[{fields:{"客户数据状态":"有效"}}]:seen.has(val)?[{record_id:"r1"}]:[]);
 spy(feishu,"upsertGmail",async(_t,m)=>{seen.add("gmail:"+m.id);return"created";});
 const old=process.env.BLOB_READ_WRITE_TOKEN;process.env.BLOB_READ_WRITE_TOKEN="synthetic-blob-only";
 return {stored,seen,actions,restore(){
  for(const x of restores)x.mock.restore();
  if(old===undefined)delete process.env.BLOB_READ_WRITE_TOKEN;else process.env.BLOB_READ_WRITE_TOKEN=old;
 }};
}
test("Gmail 403 resumes at failed message without skipping the stored page",async()=>{
 const f=setup({pages:[["a","b","c","d"]],failOnce:"c"});
 try{
  const first=res();await handler({method:"GET",headers:{}},first);
  assert.equal(first.code,502);
  const p=f.stored["crm-execution/daily-v1/gmail-state.json"];
  assert.equal(p.pendingPage.offset,2);
  assert.equal(p.counters.scanned,2);
  assert.equal(p.completed,false);
  const second=res();await handler({method:"GET",headers:{}},second);
  assert.equal(second.code,200);
  assert.equal(second.body.completed,true);
  assert.equal(second.body.counters.scanned,4);
  assert.equal(second.body.counters.created,4);
  assert.deepEqual(f.actions.filter(x=>x.type==="list").map(x=>x.i),[0]);
  assert.deepEqual(f.actions.filter(x=>x.type==="message").map(x=>x.id),["a","b","c","c","d"]);
 }finally{f.restore();}
});
test("12-message invocation budget resumes later pages without replaying historical Gmail",async()=>{
 const pages=Array.from({length:4},(_,n)=>Array.from({length:6},(_,i)=>"m"+(n*6+i)));
 const f=setup({pages});
 try{
  const first=res();await handler({method:"GET",headers:{}},first);
  assert.equal(first.code,200);assert.equal(first.body.completed,false);
  assert.equal(first.body.messagesThisRun,12);
  assert.equal(first.body.counters.pages,2);
  const second=res();await handler({method:"GET",headers:{}},second);
  assert.equal(second.code,200);assert.equal(second.body.completed,true);
  assert.equal(second.body.counters.scanned,24);
  assert.equal(f.seen.size,24);
  assert.deepEqual(f.actions.filter(x=>x.type==="list").map(x=>x.i),[0,1,2,3]);
 }finally{f.restore();}
});
test("repeated Gmail continuation token blocks writes and cursor movement",async()=>{
 const f=setup({pages:[["a"],["b"]],repeatCursor:true});
 try{
  f.stored["crm-execution/daily-v1/gmail-state.json"]={
   version:2,day:"2026-11-13",slot:"before_close",slotKey:"2026-11-13/before_close",
   windowStart:"2026-11-12T00:00:00Z",cursor:"p1",completed:false,
   counters:{scanned:0,accepted:0,excluded:0,created:0,updated:0,duplicates:0,pages:0}
  };
  const o=res();await handler({method:"GET",headers:{}},o);
  assert.equal(o.code,502);
  assert.equal(f.actions.filter(x=>x.type==="message").length,0);
  assert.equal(f.actions.filter(x=>x.type==="save").length,0);
 }finally{f.restore();}
});

test("public Gmail status reports only aggregate pending page progress",()=>{
 const {pendingGmailProgress}=require("../api/crm-status");
 const pending={ids:["secret-mail-id-a","secret-mail-id-b"],offset:1,nextCursor:"secret-cursor"};
 const snapshot=pendingGmailProgress(pending);
 assert.deepEqual(snapshot,{page_size:2,processed:1,remaining:1});
 const json=JSON.stringify(snapshot);
 assert.equal(json.includes("secret"),false);
 assert.equal(json.includes("ids"),false);
 assert.equal(pendingGmailProgress(null),null);
 assert.equal(pendingGmailProgress({ids:["a"],offset:2}),null);
 assert.equal(pendingGmailProgress({ids:["a"],offset:"0"}),null);
});

test("duplicate message IDs in a new Gmail page fail closed before any checkpoint or Feishu write",async()=>{
 const f=setup({pages:[["a","a"]]});
 try{
  const out=res();await handler({method:"GET",headers:{}},out);
  assert.equal(out.code,502);
  assert.equal(out.body.error,"daily_gmail_delta_failed");
  assert.equal(f.actions.filter(x=>x.type==="message").length,0);
  assert.equal(f.actions.filter(x=>x.type==="save").length,0);
  assert.equal(f.seen.size,0);
 }finally{f.restore();}
});

test("tampered saved pending page blocks Gmail processing without advancing cursor",async()=>{
 for(const pendingPage of [
  {ids:["a","a"],offset:0,nextCursor:"p2"},
  {ids:["a"],offset:0,nextCursor:"p1"}
 ]){
  const f=setup({pages:[["a"]]});
  try{
   f.stored["crm-execution/daily-v1/gmail-state.json"]={
    version:2,day:"2026-11-13",slot:"before_close",slotKey:"2026-11-13/before_close",
    windowStart:"2026-11-12T00:00:00Z",cursor:"p1",completed:false,pendingPage,
    counters:{scanned:0,accepted:0,excluded:0,created:0,updated:0,duplicates:0,pages:0}
   };
   const out=res();await handler({method:"GET",headers:{}},out);
   assert.equal(out.code,502);
   assert.equal(f.actions.filter(x=>x.type==="message").length,0);
   assert.equal(f.actions.filter(x=>x.type==="list").length,0);
   assert.equal(f.actions.filter(x=>x.type==="save").length,0);
   assert.equal(f.seen.size,0);
  }finally{f.restore();}
 }
});


test("mismatched Gmail response or compacted ID blocks Feishu writes and cursor advancement",async()=>{
 for(const options of [
  {messageIdOverride:{"a":"other-message"}},
  {compactIdOverride:{"a":"other-message"}}
 ]){
  const f=setup({pages:[["a"]],...options});
  try{
   const out=res();await handler({method:"GET",headers:{}},out);
   assert.equal(out.code,502);
   assert.equal(out.body.error,"daily_gmail_delta_failed");
   const state=f.stored["crm-execution/daily-v1/gmail-state.json"];
   assert.equal(state.pendingPage.offset,0);
   assert.equal(state.cursor,null);
   assert.equal(state.counters.scanned,0);
   assert.equal(f.seen.size,0);
   assert.equal(f.actions.filter(x=>x.type==="save").length,1);
  }finally{f.restore();}
 }
});


test("checkpoint save fails after Feishu creates: retry deduplicates without duplicate Case or skipped Gmail ID",async()=>{
 const f=setup({pages:[["mail-a","mail-b"]],failSaveOnceAtOffset:1});
 try{
  const first=res();await handler({method:"GET",headers:{}},first);
  assert.equal(first.code,502);
  assert.equal(f.seen.size,1); // Feishu write succeeded before private state write failed.
  assert.equal(f.stored["crm-execution/daily-v1/gmail-state.json"].pendingPage.offset,0);
  assert.equal(f.actions.filter(x=>x.type==="save-failed").length,1);
  const second=res();await handler({method:"GET",headers:{}},second);
  assert.equal(second.code,200);
  assert.equal(second.body.completed,true);
  assert.equal(f.seen.size,2); // No duplicate record; mail-b was not lost.
  assert.equal(second.body.counters.created,1);
  assert.equal(second.body.counters.duplicates,1);
  assert.deepEqual(f.actions.filter(x=>x.type==="message").map(x=>x.id),
   ["mail-a","mail-a","mail-b"]);
  assert.equal(f.actions.filter(x=>x.type==="list").length,1);
 }finally{f.restore();}
});
