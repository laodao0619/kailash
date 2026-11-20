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
  module,require:requireStub,process:{env:{CRON_SECRET:"synthetic-test-key"}},
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
