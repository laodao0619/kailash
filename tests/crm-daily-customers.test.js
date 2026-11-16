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
 const paths=[],writes=[],queries=[],progress=[];
 const progressLog=mock.method(console,"info",message=>progress.push(String(message)));
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
  assert.equal(progress.length,5,"log only safe stage entries and a committed page");
  assert.deepEqual(progress.slice(0,4),[
   "[crm-daily-customers] stage_start stage=shopify_query page_in_run=1",
   "[crm-daily-customers] stage_start stage=feishu_customer_lookup page_in_run=1",
   "[crm-daily-customers] stage_start stage=feishu_batch_write page_in_run=1",
   "[crm-daily-customers] stage_start stage=checkpoint_save page_in_run=1"
  ]);
  assert.match(progress[4],/^\[crm-daily-customers\] page_committed shopify_ms=\d+ identity_ms=\d+ write_ms=\d+ checkpoint_ms=\d+ page_ms=\d+ scanned=1 eligible=1 completed=true$/);
  assert.doesNotMatch(progress.join(" "),/customer@example\.test|gid:\/\/shopify|feishu-test/);
 }finally{for(const x of [read,save,query,token,lookup,upsert,progressLog])x.mock.restore();
  if(old===undefined)delete process.env.BLOB_READ_WRITE_TOKEN;else process.env.BLOB_READ_WRITE_TOKEN=old;}
});

test("missing or repeated Shopify next cursor preserves checkpoint and avoids all Feishu writes",async()=>{
 const old=process.env.BLOB_READ_WRITE_TOKEN;
 process.env.BLOB_READ_WRITE_TOKEN="test-token";
 const snapshot={completed:false,day:"2026-11-12",slotKey:"2026-11-12/after_store_midnight",
  windowStart:"2026-11-10T00:00:00.000Z",cursor:"cursor-original",
  counters:{scanned:1080,accepted:1080,excluded:0,created:0,updated:1080,duplicates:0,pages:36}};
 let nextCursor=null;
 const reader=mock.method(state,"read",async p=>
  p.includes("import-cursor")?{shopifyCycleComplete:true}:{...snapshot,counters:{...snapshot.counters}});
 const writer=mock.method(state,"save",async()=>{throw Error("must not change checkpoint")});
 const query=mock.method(shopify,"queryShopify",async()=>({
  customers:{nodes:[{id:"gid://shopify/Customer/123"}],
   pageInfo:{hasNextPage:true,endCursor:nextCursor}}
 }));
 const token=mock.method(feishu,"tenantToken",async()=>"feishu-test");
 const lookup=mock.method(feishu,"findBy",async()=>{throw Error("must not look up Feishu records")});
 const batch=mock.method(bulk,"batchCustomers",async()=>{throw Error("must not write Feishu records")});
 try{
  for(const value of [null,"","cursor-original"]){
   nextCursor=value;
   const response=res();
   await handler(req,response);
   assert.equal(response.code,502);
   assert.equal(response.value.error,"daily_customer_delta_failed");
  }
  assert.equal(query.mock.callCount(),3);
  assert.equal(writer.mock.callCount(),0);
  assert.equal(lookup.mock.callCount(),0);
  assert.equal(batch.mock.callCount(),0);
 }finally{
  for(const m of [reader,writer,query,token,lookup,batch])m.mock.restore();
  if(old===undefined)delete process.env.BLOB_READ_WRITE_TOKEN;
  else process.env.BLOB_READ_WRITE_TOKEN=old;
 }
});

test("Shopify failure reports only a fixed stage without leaking upstream customer PII",async()=>{
 const prior=process.env.BLOB_READ_WRITE_TOKEN;
 process.env.BLOB_READ_WRITE_TOKEN="test-token";
 const recorded=[];
 const reader=mock.method(state,"read",async path=>
  path.includes("import-cursor")?{shopifyCycleComplete:true}:{completed:false,
   windowStart:"2026-11-12T00:00:00.000Z",cursor:"confidential-cursor",
   counters:{scanned:1080,pages:36}});
 const token=mock.method(feishu,"tenantToken",async()=> "test-feishu-token");
 const query=mock.method(shopify,"queryShopify",async()=>{
  throw Error("UNTRUSTED CUSTOMER CONTENT customer@example.test access-token=secret-value");
 });
 const writer=mock.method(state,"save",async()=>{throw Error("must not write checkpoint")});
 const logs=mock.method(console,"error",(...args)=>recorded.push(args.join(" ")));
 try{
  const result=res();await handler(req,result);
  assert.equal(result.code,502);
  assert.deepEqual(result.value,{ok:false,retryable:true,error:"daily_customer_delta_failed"});
  assert.equal(query.mock.callCount(),1);
  assert.equal(writer.mock.callCount(),0);
  assert.deepEqual(recorded,["[crm-daily-customers] daily_customer_delta_failed stage=shopify_query"]);
  assert.doesNotMatch(recorded.join(" " ),/customer@example\.test|secret-value|confidential-cursor|test-feishu-token/);
 }finally{
  for(const m of [reader,token,query,writer,logs])m.mock.restore();
  if(prior===undefined)delete process.env.BLOB_READ_WRITE_TOKEN;
  else process.env.BLOB_READ_WRITE_TOKEN=prior;
 }
});

test("customer delta resolves Feishu identities with at most three reads in flight before writes",async()=>{
 const prev=process.env.BLOB_READ_WRITE_TOKEN;
 process.env.BLOB_READ_WRITE_TOKEN="test-token";
 const rows=Array.from({length:9},(_,n)=>({
  id:"gid://shopify/Customer/"+(n+1),numberOfOrders:1,
  defaultEmailAddress:{emailAddress:"synthetic"+(n+1)+"@example.test",marketingState:"SUBSCRIBED"}
 }));
 const read=mock.method(state,"read",async p=>p.includes("import-cursor")?{shopifyCycleComplete:true}:null);
 const save=mock.method(state,"save",async()=>{});
 const query=mock.method(shopify,"queryShopify",async()=>({
  customers:{nodes:rows,pageInfo:{hasNextPage:false,endCursor:null}}
 }));
 const tenant=mock.method(feishu,"tenantToken",async()=>"feishu-test");
 let active=0,maxActive=0,lookedUp=0;
 const lookup=mock.method(feishu,"findBy",async(_t,_table,_field,id)=>{
  active++;lookedUp++;maxActive=Math.max(maxActive,active);
  await new Promise(resolve=>setImmediate(resolve));
  active--;
  return [{record_id:"rec-"+id.split("/").pop()}];
 });
 const write=mock.method(bulk,"batchCustomers",async(_t,customers,index)=>{
  assert.equal(lookedUp,9,"all Feishu lookups must finish before any write");
  assert.equal(active,0);
  assert.equal(customers.length,9);
  assert.equal(index.size,9);
  assert.equal(index.get("gid://shopify/Customer/1"),"rec-1");
  return {created:0,updated:9};
 });
 try{
  const result=res();await handler(req,result);
  assert.equal(result.code,200);assert.equal(result.value.completed,true);
  assert.equal(result.value.counters.updated,9);
  assert.equal(lookedUp,9);assert.equal(maxActive,3);
  assert.equal(write.mock.callCount(),1);assert.equal(save.mock.callCount(),1);
 }finally{
  for(const m of [read,save,query,tenant,lookup,write])m.mock.restore();
  if(prev===undefined)delete process.env.BLOB_READ_WRITE_TOKEN;
  else process.env.BLOB_READ_WRITE_TOKEN=prev;
 }
});

test("repeated Shopify customer IDs fail before Feishu lookup and checkpoint mutation",async()=>{
 const prev=process.env.BLOB_READ_WRITE_TOKEN;
 process.env.BLOB_READ_WRITE_TOKEN="test-token";
 const customer={id:"gid://shopify/Customer/1",numberOfOrders:1,
  defaultEmailAddress:{emailAddress:"synthetic@example.test",marketingState:"SUBSCRIBED"}};
 const read=mock.method(state,"read",async p=>p.includes("import-cursor")?{shopifyCycleComplete:true}:null);
 const save=mock.method(state,"save",async()=>{throw Error("checkpoint must not advance")});
 const query=mock.method(shopify,"queryShopify",async()=>({
  customers:{nodes:[customer,customer],pageInfo:{hasNextPage:false,endCursor:null}}
 }));
 const tenant=mock.method(feishu,"tenantToken",async()=>"feishu-test");
 const lookup=mock.method(feishu,"findBy",async()=>{throw Error("Feishu must not be read")});
 const write=mock.method(bulk,"batchCustomers",async()=>{throw Error("Feishu must not be written")});
 const errors=mock.method(console,"error",()=>{});
 try{
  const result=res();await handler(req,result);
  assert.equal(result.code,502);assert.equal(result.value.error,"daily_customer_delta_failed");
  assert.equal(lookup.mock.callCount(),0);assert.equal(write.mock.callCount(),0);
  assert.equal(save.mock.callCount(),0);
 }finally{
  for(const m of [read,save,query,tenant,lookup,write,errors])m.mock.restore();
  if(prev===undefined)delete process.env.BLOB_READ_WRITE_TOKEN;
  else process.env.BLOB_READ_WRITE_TOKEN=prev;
 }
});

test("completed page is checkpointed and no second page starts after safe runtime budget",async()=>{
 const prior=process.env.BLOB_READ_WRITE_TOKEN;
 process.env.BLOB_READ_WRITE_TOKEN="test-token";
 let clock=1700000000000;
 const now=mock.method(Date,"now",()=>clock);
 const read=mock.method(state,"read",async p=>p.includes("import-cursor")?{shopifyCycleComplete:true}:null);
 const saves=[];
 const save=mock.method(state,"save",async(_path,data)=>{
  saves.push({cursor:data.cursor,completed:data.completed,pages:data.counters.pages});
  clock+=70000; // Simulate one slow, successfully committed page.
 });
 const query=mock.method(shopify,"queryShopify",async()=>({
  customers:{nodes:[{id:"gid://shopify/Customer/123",numberOfOrders:1,
   defaultEmailAddress:{emailAddress:"synthetic@example.test",marketingState:"SUBSCRIBED"}}],
   pageInfo:{hasNextPage:true,endCursor:"cursor-next"}}
 }));
 const tenant=mock.method(feishu,"tenantToken",async()=> "feishu-test");
 const lookup=mock.method(feishu,"findBy",async()=>[{record_id:"rec-123"}]);
 const write=mock.method(bulk,"batchCustomers",async()=>({created:0,updated:1}));
 const logs=mock.method(console,"info",()=>{});
 try{
  const response=res();await handler(req,response);
  assert.equal(response.code,200);
  assert.equal(response.value.completed,false);
  assert.equal(response.value.pagesThisRun,1);
  assert.equal(query.mock.callCount(),1,"must not start new Shopify page near runtime limit");
  assert.deepEqual(saves,[{cursor:"cursor-next",completed:false,pages:1}]);
  assert.equal(response.value.counters.updated,1);
 }finally{
  for(const m of [now,read,save,query,tenant,lookup,write,logs])m.mock.restore();
  if(prior===undefined)delete process.env.BLOB_READ_WRITE_TOKEN;
  else process.env.BLOB_READ_WRITE_TOKEN=prior;
 }
});
