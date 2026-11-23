"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {financeAuditConfiguration}=require("../lib/crm-finance-audit-preflight");
const ids=Array.from({length:7},(_,i)=>`gid://shopify/Customer/${10001+i}`);
const good={
  CRM_FINANCE_SAMPLE_CUSTOMER_IDS:ids.join(","),
  CRM_FINANCE_SAMPLE_EXPECTED_ORDER_COUNTS:JSON.stringify(Object.fromEntries(ids.map((id,i)=>[id,i+1])))
};
test("missing or partial finance sample blocks archive scanning",()=>{
  for(const env of [{},{CRM_FINANCE_SAMPLE_CUSTOMER_IDS:ids.slice(0,6).join(",")},
    {...good,CRM_FINANCE_SAMPLE_EXPECTED_ORDER_COUNTS:""},
    {...good,CRM_FINANCE_SAMPLE_EXPECTED_ORDER_COUNTS:"{bad-json"}]){
    const result=financeAuditConfiguration(env);
    assert.equal(result.ready,false);
    assert.equal(result.diagnostic.status,"BLOCKED_FINANCE_SAMPLE_CONFIGURATION");
    assert.ok(result.diagnostic.blockers.length);
  }
});
test("source counts must match exactly seven IDs and be safe integer values",()=>{
  const correct=JSON.parse(good.CRM_FINANCE_SAMPLE_EXPECTED_ORDER_COUNTS);
  const cases=[
    {...correct,[ids[0]]:-1}, {...correct,[ids[0]]:1.5},
    {...correct,[ids[0]]:"2"}, {...correct,[ids[0]]:9007199254740992},
    Object.fromEntries(ids.slice(0,6).map(id=>[id,1])),
    {...correct,"gid://shopify/Customer/999999":4},
  ];
  for(const counts of cases){
    assert.equal(financeAuditConfiguration({...good,
      CRM_FINANCE_SAMPLE_EXPECTED_ORDER_COUNTS:JSON.stringify(counts)}).ready,false);
  }
});
test("duplicate and malformed customer GIDs cannot pass",()=>{
  for(const bad of [ids.slice(0,6).concat(ids[0]),ids.slice(0,6).concat("7"),
    ids.slice(0,6).concat("gid://shopify/Customer/0")]){
    assert.equal(financeAuditConfiguration({...good,
      CRM_FINANCE_SAMPLE_CUSTOMER_IDS:bad.join(",")}).ready,false);
  }
});
test("valid seven-customer status exposes no customer IDs or private counts",()=>{
  const result=financeAuditConfiguration(good);
  assert.equal(result.ready,true);
  assert.deepEqual(result.customerIds,ids);
  assert.equal(result.diagnostic.status,"CONFIG_READY_AUDIT_NOT_APPROVED");
  assert.deepEqual(result.diagnostic.blockers,[]);
  const publicJson=JSON.stringify(result.diagnostic);
  for(const id of ids)assert.equal(publicJson.includes(id),false);
  assert.equal(publicJson.includes("10001"),false);
});

 
// Exercise the actual endpoint in an isolated VM. Stub all remote dependencies
// so these cases prove the read-only mode cannot touch the private archive.
const fs=require("node:fs");
const vm=require("node:vm");
const path=require("node:path");
const endpointSource=fs.readFileSync(path.join(__dirname,"../api/crm-orders-bulk-audit.js"),"utf8");
async function invokePreflight({query={},env=good,authorization="Bearer synthetic-cron-secret",method="GET"}={}){
  const calls={get:0,put:0,audit:0};
  const module={exports:{}};
  vm.runInNewContext(endpointSource,{
    module,Buffer,process:{env:{CRON_SECRET:"synthetic-cron-secret",...env}},
    require(name){
      if(name==="crypto")return require("node:crypto");
      if(name==="@vercel/blob")return {
        get:async()=>{calls.get++;throw Error("Unexpected archive read");},
        put:async()=>{calls.put++;throw Error("Unexpected report write");}
      };
      if(name==="../lib/crm-orders-ledger")return {auditJsonl:async()=>{calls.audit++;throw Error("Unexpected scan");}};
      if(name==="../lib/crm-finance-audit-preflight")return {financeAuditConfiguration};
      throw Error("Unexpected dependency");
    }
  });
  const response={statusCode:null,body:null,headers:{},
    setHeader(k,v){this.headers[k]=v;},
    status(n){this.statusCode=n;return this;},
    json(body){this.body=body;return this;}
  };
  await module.exports({method,headers:{authorization},query},response);
  assert.deepEqual(calls,{get:0,put:0,audit:0});
  assert.equal(response.headers["Cache-Control"],"no-store");
  return response;
}
test("ambiguous or malformed explicit preflight cannot enter the writing audit path",async()=>{
  for(const mode of [["1","1"],["1","0"],"0","true","",null,1]){
    const response=await invokePreflight({query:{preflight:mode}});
    assert.equal(response.statusCode,400);
    assert.equal(response.body.error,"invalid_preflight_mode");
    assert.equal(response.body.archiveScanned,false);
  }
});
test("authenticated preflight is read-only even with a complete configuration",async()=>{
  const response=await invokePreflight({query:{preflight:"1"}});
  assert.equal(response.statusCode,200);
  assert.equal(response.body.ok,true);
  assert.equal(response.body.financialAuditApproved,false);
  assert.equal(response.body.archiveScanned,false);
  for(const id of ids)assert.equal(JSON.stringify(response.body).includes(id),false);
});
test("unauthorized preflight and missing configuration never read the archive",async()=>{
  assert.equal((await invokePreflight({query:{preflight:"1"},authorization:"Bearer invalid"})).statusCode,401);
  const diagnostic=await invokePreflight({query:{preflight:"1"},env:{}});
  assert.equal(diagnostic.statusCode,200);
  assert.equal(diagnostic.body.ok,false);
  const audit=await invokePreflight({env:{}});
  assert.equal(audit.statusCode,409);
  assert.equal(audit.body.archiveScanned,false);
});
