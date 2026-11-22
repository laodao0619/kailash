"use strict";
// QA readiness is proof for the exact completed private index generation.
function timestamp(value){
 if(typeof value!=="string"||!value.trim())return null;
 const time=Date.parse(value);
 return Number.isFinite(time)?time:null;
}
const REQUIRED_CHECKS=Object.freeze([
 "list","sort","tier","search","customer360","productHistory",
 "mailSummary","noteRead","rfmSummary","catalog","caseCenter","rfmEight"
]);
function fullChecksPass(checks){
 return !!(checks&&typeof checks==="object"&&!Array.isArray(checks)&&
  REQUIRED_CHECKS.every(name=>Object.prototype.hasOwnProperty.call(checks,name)&&checks[name]===true)&&
  Object.values(checks).every(result=>result===true));
}
function snapshotIdentity(source){
 if(source?.version!==2||typeof source?.slot!=="string"||!source.slot||
  timestamp(source?.generatedAt)===null||!Number.isSafeInteger(source?.total)||source.total<1000)return null;
 return {version:2,slot:source.slot,generatedAt:source.generatedAt,total:source.total};
}
function sameSnapshot(one,two){
 const a=snapshotIdentity(one),b=snapshotIdentity(two);
 return !!(a&&b&&a.slot===b.slot&&a.generatedAt===b.generatedAt&&a.total===b.total);
}
function completedSnapshotMatchesState(snapshot,state){
 const source=snapshotIdentity(snapshot),completedAt=timestamp(state?.completedAt);
 return !!(source&&state?.complete===true&&state.slot===source.slot&&
  state.records===source.total&&completedAt!==null&&completedAt>=timestamp(source.generatedAt));
}
function qaMatchesSnapshot(qa,snapshot){
 const qaAt=timestamp(qa?.at),source=snapshotIdentity(snapshot);
 return !!(source&&qa?.version===4&&qa?.ready===true&&fullChecksPass(qa?.checks)&&
  sameSnapshot(qa?.sourceSnapshot,source)&&
  Number.isSafeInteger(qa?.metrics?.total)&&qa.metrics.total===source.total&&
  qaAt!==null&&qaAt>=timestamp(source.generatedAt));
}
// Public health may assert readiness only after the materialization checkpoint
// finished, even if a matching QA file and current.json already exist.
function qaMatchesCompletedSnapshot(qa,snapshot,state){
 const qaAt=timestamp(qa?.at),completedAt=timestamp(state?.completedAt);
 return !!(completedSnapshotMatchesState(snapshot,state)&&qaMatchesSnapshot(qa,snapshot)&&
  qaAt!==null&&completedAt!==null&&qaAt>=completedAt);
}
function canReuseQA(previous,state,snapshot,now=Date.now()){
 const previousAt=timestamp(previous?.at);
 return !!(previousAt!==null&&Number.isFinite(now)&&now>=previousAt&&
  now-previousAt<4*3600000&&previousAt>=timestamp(state?.completedAt)&&
  completedSnapshotMatchesState(snapshot,state)&&
  qaMatchesSnapshot(previous,snapshot));
}
module.exports={qaMatchesSnapshot,qaMatchesCompletedSnapshot,canReuseQA,REQUIRED_CHECKS,fullChecksPass,
 snapshotIdentity,sameSnapshot,completedSnapshotMatchesState};
