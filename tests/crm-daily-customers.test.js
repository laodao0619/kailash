"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {mock}=require("node:test");
const handler=require("../api/crm-daily-customers");
const state=require("../lib/crm-daily-state");
const shopify=require("../lib/crm-shopify");
const feishu=require("../lib/crm-feishu");
const bulk=require("../lib/crm-bulk-feishu");
const prev=process.env.CRON_SECRET;
process.env.CRON_SECRET="synthetic-cron-secret-test";
const req={method:"GET",headers:{authorization:"Bearer synthetic-cron-secret-test"}};
function res(){return{code:200,value:null,setHeader(){},status(code){this.code=code;return this;},json(data){this.value=data;return this;}};}
test.after(()=>{if(prev===undefined)delete process.env.CRON_SECRET;else process.env.CRON_SECRET=prev;});
test("not authorized never touches saved baseline or CRM",async()=>{
 const reader=mock.method(state,"read",async()=>{throw Error("must not read")});
 try{const response=res();await handler({...req,headers:{}},response);assert.equal(response.code,401);}
 finally{reader.mock.restore();}
});
test("missing baseline does not replay the entire customer import",async()=>{
 const old=process.env.BLOB_READ_WRITE_TOKEN;process.env.BLOB_READ_WRITE_TOKEN="test-token";
 const reader=mock.method(state,"read",async()=>null);
 try{const result=res();await handler(req,result);
  assert.equal(result.code,200);assert.equal(result.value.reason,"initial_customer_baseline_not_verified");
 }finally{reader.mock.restore();if(old===undefined)delete process.env.BLOB_READ_WRITE_TOKEN;else process.env.BLOB_READ_WRITE_TOKEN=old;}
});
test("completed baseline: upsert only changed Shopify customers and save new delta cursor",async()=>{
 const old=process.env.BLOB_READ_WRITE_TOKEN;process.env.BLOB_READ_WRITE_TOKEN="test-token";
 const paths=[],writes=[],queries=[];
 const read=mock.method(state,"read",async p=>{
  paths.push(p);
  return p.includes("import-cursor")?{shopifyCycleComplete:true}:null;
 });
 const save=mock.method(state,"save",async (p,v)=>writes.push({p,day:v.day,completed:v.completed,scanned:v.counters.scanned}));
 const query=mock.method(shopify,"queryShopify",async (_q,vars)=>{
  queries.push(vars);return {customers:{nodes:[{
   id:"gid://shopify/Customer/123",firstName:"Customer",lastName:"One",
   numberOfOrders:1,defaultEmailAddress:{emailAddress:"customer@example.test",marketingState:"SUBSCRIBED"}
  }],pageInfo:{hasNextPage:false,endCursor:null}}};
 });
 const token=mock.method(feishu,"tenantToken",async()=> "feishu-test");
 const lookup=mock.method(feishu,"findBy",async()=>[{record_id:"existing-customer"}]);
 const upsert=mock.method(bulk,"batchCustomers",async(_token,rows,index)=>{
  assert.equal(rows.length,1);assert.equal(index.get("gid://shopify/Customer/123"),"existing-customer");
  return {created:0,updated:1};
 });
 try{
  const result=res();await handler(req,result);
  assert.equal(result.code,200);assert.equal(result.value.completed,true);
  assert.equal(result.value.counters.updated,1);
  assert.equal(result.value.counters.created,0);
  assert.equal(query.mock.callCount(),1);assert.match(queries[0].filter,/updated_at:>=/);
  assert.equal(writes.length,1);assert.equal(writes[0].completed,true);
  assert.equal(paths.some(p=>p.includes("import-cursor")),true);
 }finally{for(const x of [read,save,query,token,lookup,upsert])x.mock.restore();
  if(old===undefined)delete process.env.BLOB_READ_WRITE_TOKEN;else process.env.BLOB_READ_WRITE_TOKEN=old;}
});

test("a failed concurrent identity lookup never writes a page or advances its cursor",async()=>{
 const old=process.env.BLOB_READ_WRITE_TOKEN;process.env.BLOB_READ_WRITE_TOKEN="test-token";
 const ids=[1,2,3,4].map(n=>"gid://shopify/Customer/"+n);
 const read=mock.method(state,"read",async p=>
  p.includes("import-cursor")?{shopifyCycleComplete:true}:null);
 const query=mock.method(shopify,"queryShopify",async()=>({customers:{
  nodes:ids.map(id=>({id,numberOfOrders:1,
   defaultEmailAddress:{emailAddress:id.split("/").pop()+"@example.invalid",marketingState:"SUBSCRIBED"}})),
  pageInfo:{hasNextPage:false,endCursor:null}
 }}));
 const token=mock.method(feishu,"tenantToken",async()=> "feishu-test");
 const lookup=mock.method(feishu,"findBy",async (_token,_table,_field,id)=>{
  if(id===ids[1])return [{record_id:"duplicate-A"},{record_id:"duplicate-B"}];
  return [{record_id:"existing"}];
 });
 const upsert=mock.method(bulk,"batchCustomers",async()=>{
  throw Error("Must not write a partly validated page");
 });
 const save=mock.method(state,"save",async()=>{
  throw Error("Must not advance checkpoint after identity failure");
 });
 try{
  const result=res();await handler(req,result);
  assert.equal(result.code,502);
  assert.equal(result.value.retryable,true);
  assert.equal(query.mock.callCount(),1);
  assert.equal(upsert.mock.callCount(),0);
  assert.equal(save.mock.callCount(),0);
 }finally{
  for(const x of [read,query,token,lookup,upsert,save])x.mock.restore();
  if(old===undefined)delete process.env.BLOB_READ_WRITE_TOKEN;
  else process.env.BLOB_READ_WRITE_TOKEN=old;
 }
});
