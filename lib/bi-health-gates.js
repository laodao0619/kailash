"use strict";
// Public, non-PII operational gates. "ready" on /api/bi-index-health
// remains index-materialization availability for backward compatibility.
// Passing these automated gates is NOT employee UAT or financial approval.
const REQUIRED_QA_CHECKS=Object.freeze([
 "list","sort","tier","search","customer360","productHistory",
 "mailSummary","noteRead","rfmSummary","catalog","caseCenter","rfmEight"
]);
function assess({current,qa,accessToken}={}){
 const indexReady=!!(current&&current.version===2&&Number(current.total)>=1000);
 const accessReady=typeof accessToken==="string"&&accessToken.length>=24;
 const snapAt=Date.parse(current?.generatedAt||"");
 const qaAt=Date.parse(qa?.at||"");
 const qaFresh=Number.isFinite(snapAt)&&Number.isFinite(qaAt)&&qaAt>=snapAt;
 const checksComplete=REQUIRED_QA_CHECKS.every(k=>qa?.checks?.[k]===true);
 const qaForCurrentSnapshot=qa?.ready===true&&qaFresh&&checksComplete;
 const blockers=[];
 if(!indexReady)blockers.push("index_unavailable");
 if(!accessReady)blockers.push("access_not_configured");
 if(!qaFresh)blockers.push("qa_missing_or_older_than_index");
 if(!checksComplete||qa?.ready!==true)blockers.push("required_qa_incomplete");
 return {
  indexReady,accessReady,qaFresh,qaForCurrentSnapshot,
  technicalGatesPass:indexReady&&accessReady&&qaForCurrentSnapshot,
  blockers,
  businessAcceptance:"pending_staff_uat",
  financialAcceptance:"pending_full_history_audit"
 };
}
module.exports={REQUIRED_QA_CHECKS,assess};
