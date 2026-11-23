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