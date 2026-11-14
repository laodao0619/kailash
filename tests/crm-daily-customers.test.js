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


function syntheticCustomer(i){
 return {id:"gid://shopify/Customer/"+(10000+i),
  firstName:"Buyer",lastName:"Synthetic"+i,numberOfOrders:1,
  defaultEmailAddress:{emailAddress:"buyer"+i+"@mail.test",marketingState:"SUBSCRIBED"}};
}
test("customer delta uses at most three parallel Feishu identity reads and commits after every lookup",async()=>{
 const old=process.env.BLOB_READ_WRITE_TOKEN;process.env.BLOB_READ_WRITE_TOKEN="synthetic-private-blob";
 let active=0,peak=0,lookups=0,writes=0,saves=0;
 const reader=mock.method(state,"read",async path=>path.includes("import-cursor")?{shopifyCycleComplete:true}:null);
 const token=mock.method(feishu,"tenantToken",async()=> "synthetic-token");
 const query=mock.method(shopify,"queryShopify",async()=>({customers:{
  nodes:Array.from({length:7},(_,i)=>syntheticCustomer(i)),
  pageInfo:{hasNextPage:false,endCursor:null}
 }}));
 const lookup=mock.method(feishu,"findBy",async (_token,_table,_field,id)=>{
  active++;peak=Math.max(peak,active);lookups++;
  await new Promise(resolve=>setTimeout(resolve,4));
  active--;
  return [{record_id:"rec-"+id.split("/").pop()}];
 });
 const upsert=mock.method(bulk,"batchCustomers",async(_token,customers,index)=>{
  writes++;
  assert.equal(active,0,"no Feishu writes while identity lookups are pending");
  assert.equal(customers.length,7);
  assert.equal(index.size,7);
  return {created:0,updated:7};
 });
 const save=mock.method(state,"save",async()=>{saves++;});
 try{
  const response=res();await handler(req,response);
  assert.equal(response.code,200);
  assert.equal(response.value.completed,true);
  assert.equal(response.value.counters.updated,7);
  assert.equal(lookups,7);
  assert.equal(peak,3);
  assert.equal(writes,1);
  assert.equal(saves,1);
 }finally{
  for(const x of [reader,token,query,lookup,upsert,save])x.mock.restore();
  if(old===undefined)delete process.env.BLOB_READ_WRITE_TOKEN;else process.env.BLOB_READ_WRITE_TOKEN=old;
 }
});
test("ambiguous Feishu identity fails closed before any customer write or cursor advance",async()=>{
 const old=process.env.BLOB_READ_WRITE_TOKEN;process.env.BLOB_READ_WRITE_TOKEN="synthetic-private-blob";
 let writes=0,saves=0;
 const reader=mock.method(state,"read",async path=>path.includes("import-cursor")?{shopifyCycleComplete:true}:null);
 const token=mock.method(feishu,"tenantToken",async()=> "synthetic-token");
 const query=mock.method(shopify,"queryShopify",async()=>({customers:{
  nodes:[syntheticCustomer(1),syntheticCustomer(2)],
  pageInfo:{hasNextPage:false,endCursor:null}
 }}));
 const lookup=mock.method(feishu,"findBy",async (_t,_tb,_f,id)=>
  id.endsWith("/10001")?[{record_id:"a"},{record_id:"b"}]:[]);
 const upsert=mock.method(bulk,"batchCustomers",async()=>{writes++;return {created:0,updated:2};});
 const save=mock.method(state,"save",async()=>{saves++;});
 try{
  const response=res();await handler(req,response);
  assert.equal(response.code,502);
  assert.equal(response.value.retryable,true);
  assert.equal(writes,0);
  assert.equal(saves,0);
 }finally{
  for(const x of [reader,token,query,lookup,upsert,save])x.mock.restore();
  if(old===undefined)delete process.env.BLOB_READ_WRITE_TOKEN;else process.env.BLOB_READ_WRITE_TOKEN=old;
 }
});
test("repeated customer GID within a Shopify delta page is rejected before Feishu reads",async()=>{
 const old=process.env.BLOB_READ_WRITE_TOKEN;process.env.BLOB_READ_WRITE_TOKEN="synthetic-private-blob";
 let lookups=0,writes=0,saves=0;
 const reader=mock.method(state,"read",async path=>path.includes("import-cursor")?{shopifyCycleComplete:true}:null);
 const token=mock.method(feishu,"tenantToken",async()=> "synthetic-token");
 const query=mock.method(shopify,"queryShopify",async()=>({customers:{
  nodes:[syntheticCustomer(3),syntheticCustomer(3)],
  pageInfo:{hasNextPage:false,endCursor:null}
 }}));
 const lookup=mock.method(feishu,"findBy",async()=>{lookups++;return [];});
 const upsert=mock.method(bulk,"batchCustomers",async()=>{writes++;return {created:2,updated:0};});
 const save=mock.method(state,"save",async()=>{saves++;});
 try{
  const response=res();await handler(req,response);
  assert.equal(response.code,502);
  assert.equal(lookups,0);
  assert.equal(writes,0);
  assert.equal(saves,0);
 }finally{
  for(const x of [reader,token,query,lookup,upsert,save])x.mock.restore();
  if(old===undefined)delete process.env.BLOB_READ_WRITE_TOKEN;else process.env.BLOB_READ_WRITE_TOKEN=old;
 }
});

test("invalid Shopify cursor never writes Feishu customers or advances private checkpoint",async()=>{
 const old=process.env.BLOB_READ_WRITE_TOKEN;process.env.BLOB_READ_WRITE_TOKEN="synthetic-private-blob";
 try{
  for(const [label,pageInfo,priorCursor] of [
   ["missing next cursor",{hasNextPage:true,endCursor:null},null],
   ["blank next cursor",{hasNextPage:true,endCursor:"  "},null],
   ["repeated next cursor",{hasNextPage:true,endCursor:"old-cursor"},"old-cursor"],
   ["malformed pageInfo",{hasNextPage:"true",endCursor:"next-cursor"},null]
  ]){
   let lookups=0,writes=0,saves=0;
   const checkpoint={version:2,day:"2026-11-14",slot:"before_close",
    slotKey:"2026-11-14/before_close",windowStart:"2026-11-12T01:00:00.000Z",
    cursor:priorCursor,completed:false,counters:{
     scanned:30,accepted:30,excluded:0,created:0,updated:30,duplicates:0,pages:1}};
   const reader=mock.method(state,"read",async path=>path.includes("import-cursor")?
    {shopifyCycleComplete:true}:checkpoint);
   const token=mock.method(feishu,"tenantToken",async()=> "synthetic-token");
   const query=mock.method(shopify,"queryShopify",async()=>({customers:{
    nodes:[syntheticCustomer(9)],pageInfo}}));
   const lookup=mock.method(feishu,"findBy",async()=>{lookups++;return [];});
   const upsert=mock.method(bulk,"batchCustomers",async()=>{writes++;return {created:1,updated:0};});
   const save=mock.method(state,"save",async()=>{saves++;});
   try{
    const response=res();await handler(req,response);
    assert.equal(response.code,502,label);
    assert.equal(response.value.retryable,true,label);
    assert.equal(lookups,0,label);
    assert.equal(writes,0,label);
    assert.equal(saves,0,label);
    assert.equal(checkpoint.cursor,priorCursor,label);
    assert.equal(checkpoint.counters.scanned,30,label);
   }finally{
    for(const x of [reader,token,query,lookup,upsert,save])x.mock.restore();
   }
  }
 }finally{
  if(old===undefined)delete process.env.BLOB_READ_WRITE_TOKEN;
  else process.env.BLOB_READ_WRITE_TOKEN=old;
 }
});
