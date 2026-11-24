"use strict";
const {AsyncLocalStorage}=require("node:async_hooks");
const budget=new AsyncLocalStorage();
// Scoped to the daily Gmail worker: historical and other adapters retain their behavior.
function withRequestDeadline(deadline,fn){return budget.run(deadline,fn);}
function requestOptions(){
 const deadline=budget.getStore();
 if(deadline===undefined)return {};
 const remaining=deadline-Date.now();
 if(remaining<=0)throw Error("Daily Gmail request deadline exhausted");
 return {signal:AbortSignal.timeout(Math.min(12000,remaining))};
}
async function readJson(response){
 // Never turn a truncated/aborted successful response into an empty list.
 if(budget.getStore()!==undefined)return response.json();
 return response.json().catch(()=>({}));
}
module.exports={withRequestDeadline,requestOptions,readJson};
