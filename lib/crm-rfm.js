"use strict";
// Compatibility entry point; m remains RFM spend, never lifetime spend.
function classify(input) {
 const result=require("./crm-segmentation").grade(input);
 return {...result,grade:result.grade};
}
function daysSince(iso,now=new Date()){
 if(!iso)return null;
 const d=new Date(iso);
 if(!Number.isFinite(d.getTime()))return null;
 return Math.max(0,Math.floor((now.getTime()-d.getTime())/86400000));
}
function rollup(orders,{now=new Date(),windowDays=180}={}){
 if(!Array.isArray(orders))throw new Error("orders must be array");
 const start=now.getTime()-windowDays*86400000;
 const valid=orders.filter(x=>{
  const at=new Date(x.processedAt||x.createdAt||"");
  if(!Number.isFinite(at.getTime())||at.getTime()>now.getTime()||at.getTime()<start)return false;
  if(x.test||x.cancelledAt||["VOIDED","PENDING","AUTHORIZED","EXPIRED"].includes(x.displayFinancialStatus))return false;
  return ["PAID","PARTIALLY_PAID","PARTIALLY_REFUNDED","REFUNDED"].includes(x.displayFinancialStatus);
 });
 if(valid.some(x=>!Number.isFinite(Number(x.usdNetAmount))||x.usdNetAmount==null)) return {m:null,f:null,r:null,reason:"Missing verified USD net values"};
 const spent=valid.reduce((s,x)=>s+Number(x.usdNetAmount),0);
 const last=valid.length?valid.reduce((max,x)=>Math.max(max,new Date(x.processedAt||x.createdAt).getTime()),0):null;
 return {m:Math.round(spent*100)/100,f:valid.length,r:last===null?null:daysSince(new Date(last),now),lastOrderAt:last===null?null:new Date(last).toISOString()};
}
module.exports={classify,daysSince,rollup};
