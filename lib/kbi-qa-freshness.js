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

/**
 * A green tier-filter QA must prove a non-empty, globally consistent result.
 * Array.every() on an empty response previously gave a false positive.
 */
function tierFilterEvidencePass(master,filtered,tier="S+",requestedSize=50){
 const facet=master?.facets?.tiers?.find(entry=>entry?.value===tier);
 if(!Number.isSafeInteger(facet?.count)||facet.count<=0||!filtered?.ok||
    !Array.isArray(filtered.customers)||!Number.isSafeInteger(filtered.total)||
    filtered.total!==facet.count||filtered.masterTotal!==master?.masterTotal||
    filtered.total>filtered.masterTotal||filtered.page!==1||
    filtered.pageSize!==requestedSize||
    filtered.pageCount!==Math.ceil(filtered.total/requestedSize)||
    filtered.customers.length!==Math.min(requestedSize,filtered.total))return false;
 return filtered.customers.every(row=>row?.tier===tier);
}

/**
 * Verify genuine cross-page, descending M180 sorting against the same published
 * generation. Without this check an API returning page 1 twice can pass a
 * first-page-only QA check and still break customer pagination in the UI.
 * Never stores or exposes customer rows: only returns a boolean for QA.
 */
function paginationSortEvidencePass(first,second,source){
 const identity=snapshotIdentity(source);
 if(!identity||identity.total<50||!first?.ok||!second?.ok)return false;
 const pageSize=25;
 for(const [page,number] of [[first,1],[second,2]]){
  if(page.page!==number||page.pageSize!==pageSize||
     page.asOf!==identity.generatedAt||page.slot!==identity.slot||
     page.masterTotal!==identity.total||page.total!==identity.total||
     page.pageCount!==Math.ceil(identity.total/pageSize)||
     !Array.isArray(page.customers)||page.customers.length!==pageSize)return false;
 }
 const seen=new Set();
 let last=null,unknownSeen=false,numericSeen=false;
 for(const row of [...first.customers,...second.customers]){
  const id=String(row?.id??"");
  if(!/^\d+$/.test(id)||seen.has(id))return false;
  seen.add(id);
  const value=row?.m180;
  if(value===null||value===undefined||value===""){unknownSeen=true;continue;}
  if(!Number.isFinite(value)||unknownSeen)return false;
  if(last!==null&&value>last)return false;
  numericSeen=true;last=value;
 }
 return numericSeen;
}

module.exports={paginationSortEvidencePass,tierFilterEvidencePass,qaMatchesSnapshot,qaMatchesCompletedSnapshot,canReuseQA,REQUIRED_CHECKS,fullChecksPass,
 snapshotIdentity,sameSnapshot,completedSnapshotMatchesState};
