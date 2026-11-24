"use strict";
const {AsyncLocalStorage}=require("node:async_hooks");
const budget=new AsyncLocalStorage();
// Scoped to the daily Gmail worker: historical and other adapters retain their behavior.
function withRequestDeadline(deadline,fn){return budget.run(deadline,fn);}
function boundedSignal(extra=0){
 const deadline=budget.getStore();
 if(deadline===undefined)return undefined;
 const remaining=deadline+extra-Date.now();
 if(remaining<=0)throw Error("Daily Gmail request deadline exhausted");
 return AbortSignal.timeout(Math.min(12000,remaining));
}
function requestOptions(){
 const signal=boundedSignal();
 return signal?{signal}:{};
}
// Reserve up to 15s beyond the work deadline for durable checkpoint writes.
// Do not initiate further upstream work during that reserve.
function blobRequestOptions(write=false){
 const abortSignal=boundedSignal(write?15000:0);
 return abortSignal?{abortSignal}:{};
}
async function readJson(response){
 // Never turn a truncated/aborted successful response into an empty list.
 if(budget.getStore()!==undefined)return response.json();
 return response.json().catch(()=>({}));
}
module.exports={withRequestDeadline,requestOptions,readJson,blobRequestOptions};
