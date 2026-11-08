"use strict";
const {grade,segment}=require("./crm-segmentation");
const DAY=86400000;
function summarize(orders){
 const byCustomer=new Map(),seen=new Set();
 for(const o of orders){
  if(!o?.id||!o.customerId||seen.has(o.id))continue;
  seen.add(o.id);
  if(!Number.isFinite(o.usdNetAmount)||o.usdNetAmount<0)throw Error("Unverified USD order amount");
  const at=Date.parse(o.processedAt||"");
  if(!Number.isFinite(at))throw Error("Unverified order date");
  const x=byCustomer.get(o.customerId)||{m:0,f:0,last:0};
  x.m+=o.usdNetAmount;x.f++;x.last=Math.max(x.last,at);
  byCustomer.set(o.customerId,x);
 }
 for(const x of byCustomer.values())x.m=Math.round(x.m*100)/100;
 return byCustomer;
}
function customerValues(customer,summary,{now=new Date(),windowDays=180}={}){
 const lifetimeOrders=Number(customer.lifetimeOrders);
 if(!Number.isFinite(lifetimeOrders)||lifetimeOrders<0)return {grade:"待核验",verified:false};
 const lastAt=typeof customer.lastOrderAt==="number"?customer.lastOrderAt:Date.parse(customer.lastOrderAt||"");
 const recent=summary||{m:0,f:0,last:0};
 let r=null;
 if(recent.last)r=Math.max(0,Math.floor((now.getTime()-recent.last)/DAY));
 else if(lifetimeOrders===0)r=0;
 else if(Number.isFinite(lastAt)&&lastAt<now.getTime()-windowDays*DAY)
  r=Math.max(windowDays+1,Math.floor((now.getTime()-lastAt)/DAY));
 const classification=grade({m:recent.m,r,f:recent.f,lifetimeOrders});
 const group=recent.f>0&&r!==null?segment({m:recent.m,r,f:recent.f}):{segment:null,verified:false};
 return {m:recent.m,f:recent.f,r:r===null?null:r,grade:classification.grade,
  rfm:group.segment||null,verified:classification.verified};
}
module.exports={summarize,customerValues};
