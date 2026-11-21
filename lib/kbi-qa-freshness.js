"use strict";
/**
 * QA passes only for the exact current materialized snapshot.
 * Comparing completion timestamp AND count prevents stale QA reuse even when
 * two successive snapshots happen to contain the same number of customers.
 * No client data or tokens are needed here.
 */
const REQUIRED_CHECKS=Object.freeze([
 "list","sort","tier","search","customer360","productHistory",
 "mailSummary","noteRead","rfmSummary","catalog","caseCenter","rfmEight"
]);
function verifiedForSnapshot(qa,snapshot){
 if(!qa||qa.version!==4||qa.ready!==true||!snapshot)return false;
 // A positive top-level flag cannot substitute for mandatory evidence checks.
 if(!REQUIRED_CHECKS.every(k=>qa.checks?.[k]===true))return false;
 // Match build identity as well as chronology/count; never accept legacy untagged QA.
 if(!snapshot.slot||qa.snapshotSlot!==snapshot.slot)return false;
 const qaAt=Date.parse(qa.at||"");
 const generatedAt=Date.parse(snapshot.generatedAt||"");
 return Number.isFinite(qaAt)&&Number.isFinite(generatedAt)&&
  qaAt>=generatedAt&&
  Number.isSafeInteger(snapshot.total)&&snapshot.total>=0&&
  Number.isSafeInteger(qa.metrics?.total)&&qa.metrics.total===snapshot.total;
}
function canReuseRecentQa(qa,snapshot,now=Date.now()){
 if(!verifiedForSnapshot(qa,snapshot))return false;
 const age=now-Date.parse(qa.at);
 return Number.isFinite(age)&&age>=0&&age<4*3600000;
}
module.exports={verifiedForSnapshot,canReuseRecentQa,REQUIRED_CHECKS};
