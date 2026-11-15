"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {classifyDeltaFailure}=require("../lib/crm-daily-customer-diagnostics");
test("safe diagnostics classify Feishu and Shopify failures without private text",()=>{
 const privateText="client+private@example.com token-SECRET-XYZ";
 for(const [error,phase,expected,retryable,blocked] of [
  [`Ambiguous Shopify identity in CRM mirror ${privateText}`,"feishu_identity_lookup","customer_identity_conflict",false,true],
  [`Malformed customer delta response ${privateText}`,"shopify_page","shopify_delta_response_invalid",false,true],
  [`Feishu 403 ${privateText}`,"feishu_auth","upstream_authorization_failed",false,true],
  [`429 rate limit ${privateText}`,"feishu_batch_write","upstream_rate_limited",true,false],
  [`ETIMEDOUT ${privateText}`,"checkpoint_save","upstream_temporarily_unavailable",true,false],
  [`unexpected ${privateText}`,"baseline_read","upstream_failure",true,false],
 ]){
  const result=classifyDeltaFailure(new Error(error),phase);
  assert.equal(result.code,expected);
  assert.equal(result.retryable,retryable);
  assert.equal(result.blocked,blocked);
  assert.equal(result.phase,phase);
  assert(!JSON.stringify(result).includes(privateText));
 }
});
test("phase is fixed allowlist and arbitrary strings never reflect",()=>{
 assert.equal(classifyDeltaFailure(new Error("fail"),"client@example.com").phase,"unknown");
 assert.deepEqual(Object.keys(classifyDeltaFailure(null,null)).sort(),["blocked","code","phase","retryable"]);
});
