"use strict";
// Authorized cron-only diagnostics. Never echo upstream error bodies, customer
// identifiers, request URLs, email addresses, tokens or record field values.
const PHASES=new Set(["baseline_read","checkpoint_read","feishu_auth","shopify_page","feishu_identity_lookup","feishu_batch_write","checkpoint_save"]);
function classifyDeltaFailure(error,phase){
 const message=String(error?.message||error||"");
 let code="upstream_failure",retryable=true,blocked=false;
 if(/Ambiguous Shopify identity|Duplicate Shopify Customer ID|duplicate customer id|customer identity.*ambiguous/i.test(message)){
  code="customer_identity_conflict";retryable=false;blocked=true;
 }else if(/Malformed customer delta response|missing.*cursor|invalid.*cursor|graphql.*invalid/i.test(message)){
  code="shopify_delta_response_invalid";retryable=false;blocked=true;
 }else if(/\b(?:401|403)\b|unauthorized|forbidden|invalid.access.token/i.test(message)){
  code="upstream_authorization_failed";retryable=false;blocked=true;
 }else if(/\b429\b|throttl|rate.?limit|quota.exceeded/i.test(message)){
  code="upstream_rate_limited";
 }else if(/timeout|timed.out|ETIMEDOUT|ECONNRESET|\b(?:500|502|503|504)\b/i.test(message)){
  code="upstream_temporarily_unavailable";
 }
 return {code,phase:PHASES.has(phase)?phase:"unknown",retryable,blocked};
}
module.exports={classifyDeltaFailure};
