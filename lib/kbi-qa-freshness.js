"use strict";
// Passing QA only proves the exact completed customer-index snapshot it checked.
function timestamp(value){
 if(typeof value!=="string"||!value.trim())return null;
 const time=Date.parse(value);
 return Number.isFinite(time)?time:null;
}
function qaMatchesSnapshot(qa,snapshot){
 const qaAt=timestamp(qa?.at),snapshotAt=timestamp(snapshot?.generatedAt);
 return !!(qa?.ready===true&&qa?.checks&&Object.keys(qa.checks).length>0&&
  Object.values(qa.checks).every(result=>result===true)&&
  Number.isSafeInteger(qa?.metrics?.total)&&Number.isSafeInteger(snapshot?.total)&&
  qa.metrics.total===snapshot.total&&qaAt!==null&&snapshotAt!==null&&qaAt>=snapshotAt);
}
function canReuseQA(previous,state,now=Date.now()){
 const previousAt=timestamp(previous?.at);
 return !!(previous?.version===4&&state?.complete===true&&previousAt!==null&&
  Number.isFinite(now)&&now>=previousAt&&now-previousAt<4*3600000&&
  qaMatchesSnapshot(previous,{generatedAt:state.completedAt,total:state.records}));
}
module.exports={qaMatchesSnapshot,canReuseQA};
