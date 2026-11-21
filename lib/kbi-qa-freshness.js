"use strict";
/**
 * QA passes only for the exact current materialized snapshot.
 * Comparing completion timestamp AND count prevents stale QA reuse even when
 * two successive snapshots happen to contain the same number of customers.
 * No client data or tokens are needed here.
 */
function verifiedForSnapshot(qa,snapshot){
 if(!qa||qa.ready!==true||!snapshot)return false;
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
module.exports={verifiedForSnapshot,canReuseRecentQa};
