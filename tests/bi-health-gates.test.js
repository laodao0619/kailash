"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {assess,REQUIRED_QA_CHECKS}=require("../lib/bi-health-gates");
const current={version:2,total:10853,generatedAt:"2026-11-16T00:15:00.000Z"};
const completeChecks=Object.fromEntries(REQUIRED_QA_CHECKS.map(k=>[k,true]));
const goodQa={ready:true,at:"2026-11-16T00:20:00.000Z",checks:completeChecks};
const secret="synthetic-test-only-token-of-safe-length";
test("index materialization alone cannot imply login, QA, financial or staff acceptance",()=>{
 const result=assess({current,qa:{ready:false,at:"2026-11-16T00:25:00.000Z",checks:{list:false}}});
 assert.equal(result.indexReady,true);
 assert.equal(result.accessReady,false);
 assert.equal(result.qaForCurrentSnapshot,false);
 assert.equal(result.technicalGatesPass,false);
 assert.deepEqual(result.blockers,["access_not_configured","required_qa_incomplete"]);
 assert.equal(result.businessAcceptance,"pending_staff_uat");
 assert.equal(result.financialAcceptance,"pending_full_history_audit");
 assert(!JSON.stringify(result).includes(secret));
});
test("green QA from an older snapshot must not validate a newly built index",()=>{
 const result=assess({current,qa:{...goodQa,at:"2026-11-15T23:59:59.000Z"},accessToken:secret});
 assert.equal(result.qaFresh,false);
 assert.equal(result.qaForCurrentSnapshot,false);
 assert.equal(result.technicalGatesPass,false);
 assert(result.blockers.includes("qa_missing_or_older_than_index"));
});
test("partial legacy QA missing v2 Customer360 and RFM checks cannot pass",()=>{
 const qa={...goodQa,checks:{list:true,sort:true,tier:true,search:true}};
 const result=assess({current,qa,accessToken:secret});
 assert.equal(result.qaFresh,true);
 assert.equal(result.qaForCurrentSnapshot,false);
 assert(result.blockers.includes("required_qa_incomplete"));
});
test("all current checks and access configuration only establish technical gates",()=>{
 const result=assess({current,qa:goodQa,accessToken:secret});
 assert.equal(result.technicalGatesPass,true);
 assert.deepEqual(result.blockers,[]);
 assert.equal(result.businessAcceptance,"pending_staff_uat");
 assert.equal(result.financialAcceptance,"pending_full_history_audit");
 assert.equal(JSON.stringify(result).includes(secret),false);
});
test("missing or malformed timestamps fail closed",()=>{
 for(const qa of [null,{...goodQa,at:"invalid"},{...goodQa,at:null}]){
  const result=assess({current,qa,accessToken:secret});
  assert.equal(result.qaForCurrentSnapshot,false);
  assert.equal(result.technicalGatesPass,false);
 }
 assert.equal(assess({current:{...current,generatedAt:null},qa:goodQa,accessToken:secret}).qaFresh,false);
 assert.equal(assess({current:null,qa:goodQa,accessToken:secret}).indexReady,false);
});
