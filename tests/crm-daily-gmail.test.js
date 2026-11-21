"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {mock}=require("node:test");
const handler=require("../api/crm-daily-gmail");
const state=require("../lib/crm-daily-state");
const gmail=require("../lib/crm-gmail");
const feishu=require("../lib/crm-feishu");
const prev=process.env.CRON_SECRET;
process.env.CRON_SECRET="synthetic-cron-secret-test";
const req={method:"GET",headers:{authorization:"Bearer synthetic-cron-secret-test"}};
function res(){return{code:200,value:null,setHeader(){},status(code){this.code=code;return this;},json(data){this.value=data;return this;}};}
test.after(()=>{if(prev===undefined)delete process.env.CRON_SECRET;else process.env.CRON_SECRET=prev;});
test("Gmail delta refuses work only when customer baseline is missing",async()=>{
 const old=process.env.BLOB_READ_WRITE_TOKEN;process.env.BLOB_READ_WRITE_TOKEN="test-blob";
 const reader=mock.method(state,"read",async()=>null);
 try{
  const out=res();await handler(req,out);
  assert.equal(out.code,200);assert.equal(out.value.reason,"initial_customer_baseline_not_verified");
 }finally{reader.mock.restore();if(old===undefined)delete process.env.BLOB_READ_WRITE_TOKEN;else process.env.BLOB_READ_WRITE_TOKEN=old;}
});
test("daily mail sync matches unique identity, deduplicates, saves only incremental checkpoint",async()=>{
 const old=process.env.BLOB_READ_WRITE_TOKEN;process.env.BLOB_READ_WRITE_TOKEN="test-blob";
 const restores=[];
 function spy(obj,key,fn){const m=mock.method(obj,key,fn);restores.push(m);return m;}
 const writes=[],lookups=[];
 spy(state,"read",async p=>p.includes("gmail-filtered-cursor")?{finished:true}:p.includes("import-cursor")?{shopifyCycleComplete:true}:null);
 spy(state,"save",async(p,v)=>writes.push({p,cursor:v.cursor,completed:v.completed}));
 spy(gmail,"token",async()=>"gmail-test");
 spy(gmail,"listMessages",async(_t,args)=>{
  assert.equal(args.after?.endsWith("Z"),true);
  return {messages:[{id:"msg-new-1"},{id:"msg-seen-2"}],nextPageToken:null};
 });
 spy(gmail,"message",async(_t,id)=>({id,threadId:"thread-1",labelIds:["INBOX"],internalDate:"1794120000000",
  payload:{headers:[{name:"From",value:"Test <buyer@example.test>"},{name:"Date",value:"Sun, 8 Nov 2026 11:00:00 +0000"},
   {name:"Subject",value:"Package enquiry"}]}}));
 spy(feishu,"tenantToken",async()=>"feishu-test");
 spy(feishu,"findBy",async(_t,_table,field,value)=>{
  lookups.push({field,value});
  if(field==="邮箱")return [{record_id:"owner-1",fields:{"客户数据状态":"有效"}}];
  return value==="gmail:msg-seen-2"?[{record_id:"already"}]:[];
 });
 const upsert=spy(feishu,"upsertGmail",async(_t,m)=>{
  assert.equal(m.customerEmail,"buyer@example.test");assert.equal(m.id,"msg-new-1");
  return "created";
 });
 try{
  const out=res();await handler(req,out);
  assert.equal(out.code,200);assert.equal(out.value.completed,true);
  assert.equal(out.value.counters.created,1);
  assert.equal(out.value.counters.duplicates,1);
  assert.equal(upsert.mock.callCount(),1);
  assert.equal(writes[0].completed,true);
  assert.equal(lookups.some(x=>x.field==="数据来源ID"&&x.value==="gmail:msg-new-1"),true);
 }finally{for(const r of restores)r.mock.restore();if(old===undefined)delete process.env.BLOB_READ_WRITE_TOKEN;else process.env.BLOB_READ_WRITE_TOKEN=old;}
});


test("Gmail delta commits small, complete pages before advancing its cursor",async()=>{
 const previous=process.env.BLOB_READ_WRITE_TOKEN;
 process.env.BLOB_READ_WRITE_TOKEN="synthetic-private-blob";
 const restores=[];
 function spy(obj,name,fn){const m=mock.method(obj,name,fn);restores.push(m);return m;}
 const requests=[],saves=[];
 spy(state,"read",async path=>path.includes("gmail-filtered-cursor")?{finished:true}:
  path.includes("import-cursor")?{shopifyCycleComplete:true}:null);
 spy(state,"save",async(path,checkpoint)=>saves.push({
  path,cursor:checkpoint.cursor,completed:checkpoint.completed,
  scanned:checkpoint.counters.scanned,pages:checkpoint.counters.pages
 }));
 spy(gmail,"token",async()=>"synthetic-gmail-token");
 spy(feishu,"tenantToken",async()=>"synthetic-feishu-token");
 spy(gmail,"listMessages",async(_token,args)=>{
  requests.push({cursor:args.pageToken||null,maxResults:args.maxResults});
  const ids=requests.length===1?["m1","m2","m3"]:["m4","m5"];
  return {messages:ids.map(id=>({id})),nextPageToken:requests.length===1?"page-two":null};
 });
 spy(gmail,"message",async(_token,id)=>({
  id,threadId:"synthetic-thread",labelIds:["INBOX"],internalDate:"1794120000000",
  payload:{headers:[
   {name:"From",value:"no-reply@shopify.com"},
   {name:"Date",value:"Sun, 8 Nov 2026 11:00:00 +0000"},
   {name:"Subject",value:"Automated notice"}
  ]}
 }));
 try{
  const out=res();await handler(req,out);
  assert.equal(out.code,200);
  assert.equal(out.value.completed,true);
  assert.equal(out.value.counters.scanned,5);
  assert.equal(out.value.counters.excluded,5);
  assert.equal(out.value.counters.pages,2);
  assert.deepEqual(requests,[
   {cursor:null,maxResults:3},
   {cursor:"page-two",maxResults:3}
  ]);
  assert.deepEqual(saves.map(s=>[s.cursor,s.completed,s.scanned,s.pages]),[
   ["page-two",false,3,1],
   [null,true,5,2]
  ]);
 }finally{
  for(const m of restores)m.mock.restore();
  if(previous===undefined)delete process.env.BLOB_READ_WRITE_TOKEN;
  else process.env.BLOB_READ_WRITE_TOKEN=previous;
 }
});

test("Gmail transient failure never advances page cursor before safe retry",async()=>{
 const previous=process.env.BLOB_READ_WRITE_TOKEN;
 process.env.BLOB_READ_WRITE_TOKEN="synthetic-private-blob";
 const restores=[];
 function spy(obj,name,fn){const m=mock.method(obj,name,fn);restores.push(m);return m;}
 let saved=null,failSecond=true;
 const writes=[],requests=[],upserts=new Set();
 spy(state,"read",async path=>path.includes("gmail-filtered-cursor")?{finished:true}:
  path.includes("import-cursor")?{shopifyCycleComplete:true}:saved);
 spy(state,"save",async(_path,value)=>{
  writes.push({cursor:value.cursor,completed:value.completed,scanned:value.counters.scanned});
  saved=structuredClone(value);
 });
 spy(gmail,"token",async()=>"synthetic-gmail-token");
 spy(feishu,"tenantToken",async()=>"synthetic-feishu-token");
 spy(gmail,"listMessages",async(_token,args)=>{
  requests.push(args.pageToken||null);
  return {messages:[{id:"synthetic-m1"},{id:"synthetic-m2"}],nextPageToken:null};
 });
 spy(gmail,"message",async(_token,id)=>{
  if(id==="synthetic-m2"&&failSecond)throw Error("synthetic transient Gmail 503");
  return {id,threadId:"synthetic-thread",labelIds:["INBOX"],internalDate:"1794120000000",
   payload:{headers:[
    {name:"From",value:"Test <buyer@example.test>"},
    {name:"Date",value:"Sun, 8 Nov 2026 11:00:00 +0000"},
    {name:"Subject",value:"Package enquiry"}
   ]}};
 });
 spy(feishu,"findBy",async(_token,_table,field,value)=>{
  if(field==="邮箱")return [{record_id:"synthetic-owner",fields:{"客户数据状态":"有效"}}];
  return field==="数据来源ID"&&upserts.has(value.slice(6))?[{record_id:"existing"}]:[];
 });
 spy(feishu,"upsertGmail",async(_token,message)=>{
  upserts.add(message.id);
  return "created";
 });
 try{
  const first=res();await handler(req,first);
  assert.equal(first.code,502);
  assert.equal(first.value.retryable,true);
  assert.equal(writes.length,0,"failed page must not persist its cursor");
  assert.deepEqual([...upserts],["synthetic-m1"],"first write was real and must be deduplicated on retry");
  failSecond=false;
  const second=res();await handler(req,second);
  assert.equal(second.code,200);
  assert.equal(second.value.completed,true);
  assert.deepEqual(requests,[null,null],"retry must start from the same uncommitted page");
  assert.deepEqual([...upserts].sort(),["synthetic-m1","synthetic-m2"]);
  assert.equal(second.value.counters.duplicates,1);
  assert.equal(second.value.counters.created,1);
  assert.equal(writes.length,1);
  assert.equal(writes[0].completed,true);
 }finally{
  for(const m of restores)m.mock.restore();
  if(previous===undefined)delete process.env.BLOB_READ_WRITE_TOKEN;
  else process.env.BLOB_READ_WRITE_TOKEN=previous;
 }
});
