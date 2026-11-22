"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const crypto=require("node:crypto");

// These are synthetic secret markers only. Never read actual runtime credentials
// or call Shopify/Feishu/Vercel in CI.
const sensitive="PRIVATE_CUSTOMER_GID_987654_SIGNED_BLOB_TOKEN";
function loadRoute(filename) {
 const source=fs.readFileSync(path.join(__dirname,"../api",filename),"utf8");
 const module={exports:{}};
 const requireStub=name=>{
  if(name==="crypto")return crypto;
  if(name==="@vercel/blob")return {get:async()=>{throw Error(sensitive);},put:async()=>{throw Error(sensitive);}};
  if(name==="../lib/crm-shopify")return {orderAccess:async()=>{throw Error(sensitive);}};
  if(name==="../lib/crm-orders-bulk")return {isExplicitBulkExportEnabled:()=>true};
  if(name==="../lib/crm-orders-ledger")return {auditJsonl:async()=>{throw Error(sensitive);}};
  throw Error("Unexpected test dependency");
 };
 vm.runInNewContext(source,{
  module,require:requireStub,process:{env:{CRON_SECRET:"synthetic-test-key",VERCEL_ENV:"production"}},
  Buffer,console
 },{filename});
 return module.exports;
}
function response(){
 return {
  statusCode:200,body:null,headers:{},
  setHeader(name,value){this.headers[name]=value;},
  status(code){this.statusCode=code;return this;},
  json(body){this.body=body;return this;}
 };
}
for(const [filename,code] of [
 ["crm-orders-bulk.js","bulk_export_failed"],
 ["crm-orders-bulk-audit.js","financial_audit_failed"]
]){
 test(filename+" redacts arbitrary upstream errors from authenticated responses",async()=>{
  const handler=loadRoute(filename);
  const res=response();
  await handler({method:"GET",headers:{authorization:"Bearer synthetic-test-key"}},res);
  assert.equal(res.statusCode,502);
  assert.equal(res.headers["Cache-Control"],"no-store");
  assert.equal(res.body.ok,false);
  assert.equal(res.body.retryable,true);
  assert.equal(res.body.error,code);
  assert.doesNotMatch(JSON.stringify(res.body),/PRIVATE_CUSTOMER_GID|SIGNED_BLOB_TOKEN/);
 });
 test(filename+" does not disclose finance evidence without authorization",async()=>{
  const handler=loadRoute(filename),res=response();
  await handler({method:"GET",headers:{authorization:"Bearer incorrect-key"}},res);
  assert.equal(res.statusCode,401);
  assert.equal(res.body.ok,false);
  assert.doesNotMatch(JSON.stringify(res.body),/PRIVATE_CUSTOMER_GID|SIGNED_BLOB_TOKEN/);
 });
}


// No production services are contacted. Validate that a missing checkpoint
// cannot overwrite a previously archived private Shopify JSONL export.
function loadImmutableBulkRoute({stateResponse=null,archiveResponse=null,failRawPut=false}={}){
 const {Readable}=require("node:stream");
 const source=fs.readFileSync(path.join(__dirname,"../api/crm-orders-bulk.js"),"utf8");
 const requests={starts:0,rawPuts:[],statePuts:[],reads:[]};
 const requireStub=name=>{
  if(name==="crypto")return crypto;
  if(name==="@vercel/blob")return {
   get:async key=>{
    requests.reads.push(key);
    if(key.endsWith("-state.json"))return stateResponse;
    if(key.endsWith("-export.jsonl"))return archiveResponse;
    throw Error("Unexpected private blob path");
   },
   put:async(key,body,options)=>{
    if(key.endsWith("-export.jsonl")){
     requests.rawPuts.push(options);
     if(failRawPut)throw Error("synthetic immutable blob collision");
    }else requests.statePuts.push({key,options});
    return {url:"private-test://archive"};
   }
  };
  if(name==="../lib/crm-shopify")return {
   orderAccess:async()=>({read_orders:true,read_all_orders:true,read_products:true}),
   queryShopify:async()=>{throw Error("query stub not expected");}
  };
  if(name==="../lib/crm-orders-bulk")return {
   isExplicitBulkExportEnabled:()=>true,
   start:async()=>{requests.starts++;return {id:"test-op",status:"CREATED"};},
   poll:async()=>({status:"COMPLETED",url:"https://example.invalid/signed",objectCount:"2",rootObjectCount:"1"}),
   downloadUrl:()=> "https://example.invalid/signed"
  };
  throw Error("Unexpected dependency: "+name);
 };
 const module={exports:{}};
 vm.runInNewContext(source,{
  module,require:requireStub,process:{env:{CRON_SECRET:"synthetic-test-key"}},
  Buffer,console,Date,AbortSignal:{timeout:()=>undefined},
  fetch:async()=>({ok:true,body:Readable.from(["synthetic JSONL\n"])}),
 },{filename:"crm-orders-bulk.js"});
 return {handler:module.exports,requests};
}
const authorizedBulkReq={method:"GET",headers:{authorization:"Bearer synthetic-test-key"}};
test("orphaned Shopify Bulk archive blocks a new export before Shopify start or overwrite",async()=>{
 const {handler,requests}=loadImmutableBulkRoute({archiveResponse:{statusCode:200}});
 const res=response();
 await handler(authorizedBulkReq,res);
 assert.equal(res.statusCode,409);
 assert.equal(res.body.blockedReason,"bulk_archive_exists_without_checkpoint");
 assert.equal(res.body.reviewRequired,true);
 assert.equal(requests.starts,0);
 assert.equal(requests.rawPuts.length,0);
 assert.equal(requests.statePuts.length,0);
});
test("unavailable Bulk checkpoint cannot be mistaken for an absent checkpoint",async()=>{
 const {handler,requests}=loadImmutableBulkRoute({stateResponse:{statusCode:503}});
 const res=response();
 await handler(authorizedBulkReq,res);
 assert.equal(res.statusCode,502);
 assert.equal(res.body.error,"bulk_export_failed");
 assert.equal(requests.starts,0);
 assert.equal(requests.rawPuts.length,0);
});
test("malformed or oversized private Bulk checkpoint blocks restart and all writes",async()=>{
 const {Readable}=require("node:stream");
 const badStates=[
  "null", "[]", "{}", "{invalid-json",
  JSON.stringify({id:"test-op",status:"RUNNING",downloaded:"false"}),
  JSON.stringify({id:"test-op",status:"COMPLETED",downloaded:true,completed:false}),
  "x".repeat(16385),
 ];
 for(const raw of badStates){
  const {handler,requests}=loadImmutableBulkRoute({
   stateResponse:{statusCode:200,stream:Readable.from([raw])}
  });
  const res=response();
  await handler(authorizedBulkReq,res);
  assert.equal(res.statusCode,502);
  assert.equal(res.body.error,"bulk_export_failed");
  assert.equal(requests.starts,0);
  assert.equal(requests.rawPuts.length,0);
  assert.equal(requests.statePuts.length,0);
  assert.deepEqual(requests.reads,["crm-execution/orders-bulk-v1-state.json"]);
 }
});

test("completed Bulk operation stores immutable raw JSONL and updates checkpoint afterwards",async()=>{
 const {Readable}=require("node:stream");
 const stateResponse={statusCode:200,stream:Readable.from([
  Buffer.from(JSON.stringify({id:"synthetic-completed",status:"RUNNING",downloaded:false}))
 ])};
 const {handler,requests}=loadImmutableBulkRoute({stateResponse});
 const res=response();
 await handler(authorizedBulkReq,res);
 assert.equal(res.statusCode,200);
 assert.equal(res.body.phase,"archived");
 assert.equal(requests.rawPuts.length,1);
 assert.equal(requests.rawPuts[0].access,"private");
 assert.equal(requests.rawPuts[0].allowOverwrite,false);
 assert.equal(requests.statePuts.length,1);
});
test("immutable archive collision keeps checkpoint unadvanced for manual review",async()=>{
 const {Readable}=require("node:stream");
 const stateResponse={statusCode:200,stream:Readable.from([
  Buffer.from(JSON.stringify({id:"synthetic-completed",status:"RUNNING",downloaded:false}))
 ])};
 const {handler,requests}=loadImmutableBulkRoute({stateResponse,failRawPut:true});
 const res=response();
 await handler(authorizedBulkReq,res);
 assert.equal(res.statusCode,502);
 assert.equal(requests.rawPuts[0].allowOverwrite,false);
 assert.equal(requests.statePuts.length,0);
 assert.equal(res.body.error,"bulk_export_failed");
});


test("archived checkpoint must verify that the private JSONL evidence still exists",async()=>{
 const {Readable}=require("node:stream");
 const makeState=()=>({statusCode:200,stream:Readable.from([
  Buffer.from(JSON.stringify({id:"synthetic-done",status:"COMPLETED",downloaded:true,objectCount:"3",rootObjectCount:"2"}))
 ])});
 for(const [archiveResponse,expectedStatus,expectedReason] of [
  [{statusCode:200},200,undefined],
  [{statusCode:404},409,"bulk_archive_missing_after_checkpoint"],
  [null,409,"bulk_archive_missing_after_checkpoint"],
  [{statusCode:503},502,undefined],
 ]){
  const {handler,requests}=loadImmutableBulkRoute({stateResponse:makeState(),archiveResponse});
  const res=response();
  await handler(authorizedBulkReq,res);
  assert.equal(res.statusCode,expectedStatus);
  if(expectedStatus===200){
   assert.equal(res.body.phase,"archived");
   assert.equal(res.body.objectCount,"3");
  }
  if(expectedStatus===409){
   assert.equal(res.body.blockedReason,expectedReason);
   assert.equal(res.body.reviewRequired,true);
  }
  if(expectedStatus===502)assert.equal(res.body.error,"bulk_export_failed");
  assert.equal(requests.starts,0);
  assert.equal(requests.rawPuts.length,0);
  assert.equal(requests.statePuts.length,0);
 }
});

 
// Finance audit has no permission to read an archived customer ledger in a
// Vercel Preview or to overwrite the production report through a copied token.
// These cases use only in-memory synthetic Blob and ledger stubs.
function loadProtectedFinanceAudit({stage="preview",archiveStatus=200,stateStatus=200}={}){
 const {Readable}=require("node:stream");
 const source=fs.readFileSync(path.join(__dirname,"../api/crm-orders-bulk-audit.js"),"utf8");
 const stats={reads:[],writes:0,audits:0};
 const blobResponse=status=>({statusCode:status,stream:Readable.from(["{}"])});
 const requireStub=name=>{
  if(name==="crypto")return crypto;
  if(name==="@vercel/blob")return {
   get:async key=>{
    stats.reads.push(key);
    if(key.endsWith("-export.jsonl"))return blobResponse(archiveStatus);
    if(key.endsWith("-state.json"))return blobResponse(stateStatus);
    throw Error("Unexpected private Blob read");
   },
   put:async()=>{stats.writes++;return {url:"private-test://audit"};}
  };
  if(name==="../lib/crm-orders-ledger")return {
   auditJsonl:async()=>{stats.audits++;return {sampleAudit:{status:"BLOCKED_REQUIRE_EXACTLY_SEVEN_SAMPLE_CUSTOMERS"}};},
   verifyArchiveIntegrity:()=>({status:"BLOCKED_EXPORT_NOT_ARCHIVED"})
  };
  throw Error("Unexpected audit dependency: "+name);
 };
 const module={exports:{}};
 vm.runInNewContext(source,{
  module,require:requireStub,
  process:{env:{CRON_SECRET:"synthetic-test-key",VERCEL_ENV:stage}},
  Buffer,console,Date
 },{filename:"crm-orders-bulk-audit.js"});
 return {handler:module.exports,stats};
}
test("private financial audit refuses non-production stages before any Blob read or report write",async()=>{
 for(const stage of ["preview","development","staging","",null,undefined]){
  const {handler,stats}=loadProtectedFinanceAudit({stage});
  const res=response();
  await handler(authorizedBulkReq,res);
  assert.equal(res.statusCode,403,String(stage));
  assert.equal(res.body.blockedReason,"finance_audit_production_only");
  assert.equal(stats.reads.length,0);
  assert.equal(stats.writes,0);
  assert.equal(stats.audits,0);
 }
});
test("private financial audit still checks authorization before disclosing its stage",async()=>{
 const {handler,stats}=loadProtectedFinanceAudit({stage:"preview"});
 const res=response();
 await handler({method:"GET",headers:{authorization:"Bearer wrong"}},res);
 assert.equal(res.statusCode,401);
 assert.equal(stats.reads.length,0);
});
test("an inaccessible private financial archive is an error, never an empty waiting state",async()=>{
 const {handler,stats}=loadProtectedFinanceAudit({stage:"production",archiveStatus:403});
 const res=response();
 await handler(authorizedBulkReq,res);
 assert.equal(res.statusCode,502);
 assert.equal(res.body.error,"financial_audit_failed");
 assert.equal(stats.reads.length,1);
 assert.equal(stats.writes,0);
 assert.equal(stats.audits,0);
});
test("an unreadable private financial checkpoint blocks report overwrite",async()=>{
 const {handler,stats}=loadProtectedFinanceAudit({stage:"production",stateStatus:503});
 const res=response();
 await handler(authorizedBulkReq,res);
 assert.equal(res.statusCode,502);
 assert.equal(res.body.error,"financial_audit_failed");
 assert.equal(stats.reads.length,2);
 assert.equal(stats.writes,0);
 assert.equal(stats.audits,1);
});
test("a verified absent archive remains a waiting state without an audit write",async()=>{
 const {handler,stats}=loadProtectedFinanceAudit({stage:"production",archiveStatus:404});
 const res=response();
 await handler(authorizedBulkReq,res);
 assert.equal(res.statusCode,200);
 assert.equal(res.body.waiting,true);
 assert.equal(stats.reads.length,1);
 assert.equal(stats.writes,0);
 assert.equal(stats.audits,0);
});
