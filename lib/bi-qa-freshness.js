"use strict";
// Compares operational QA with the *snapshot it actually verified*.
// A successful QA from yesterday cannot attest today's materialized CRM index.
const MAX_QA_AGE_MS=4*60*60*1000;
function timestamp(value){
 if(typeof value!=="string"||!value.trim())return null;
 const parsed=Date.parse(value);
 return Number.isFinite(parsed)?parsed:null;
}
function isQaCurrentForSnapshot(qa,generatedAt){
 const qaAt=timestamp(qa?.at),indexAt=timestamp(generatedAt);
 return qa?.ready===true&&qaAt!==null&&indexAt!==null&&qaAt>=indexAt;
}
function canReuseQa(qa,buildState,now=Date.now()){
 const qaAt=timestamp(qa?.at);
 return qa?.version===4&&buildState?.complete===true&&
  isQaCurrentForSnapshot(qa,buildState.completedAt)&&
  Number.isFinite(now)&&qaAt<=now&&now-qaAt<MAX_QA_AGE_MS;
}
module.exports={isQaCurrentForSnapshot,canReuseQa};
