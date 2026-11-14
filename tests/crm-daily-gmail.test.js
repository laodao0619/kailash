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
  assert.equal(writes.at(-1).completed,true);
  assert.equal(lookups.some(x=>x.field==="数据来源ID"&&x.value==="gmail:msg-new-1"),true);
 }finally{for(const r of restores)r.mock.restore();if(old===undefined)delete process.env.BLOB_READ_WRITE_TOKEN;else process.env.BLOB_READ_WRITE_TOKEN=old;}
});
