"use strict";
/**
 * Read-only rollup of the existing private CRM index. No Shopify re-import,
 * no recalculation of disputed historical net order/return ledger.
 */
const TIERS=["S+","S","A","B","基础客户","沉睡","从未购买","待核验"];
const numeric=v=>typeof v==="number"&&Number.isFinite(v)?v:null;
function sum(rows,key){
 let value=0,coverage=0;
 for(const r of rows){const n=numeric(r[key]);if(n===null)continue;value+=n;coverage++;}
 return {value:Math.round(value*100)/100,coverage,total:rows.length};
}
function tally(rows,key,unknown="未分类"){
 const map=new Map();
 for(const r of rows){const value=String(r[key]??"").trim()||unknown;map.set(value,(map.get(value)||0)+1);}
 return [...map].map(([name,count])=>({name,count})).sort((a,b)=>b.count-a.count);
}
function summarize(snapshot){
 const rows=snapshot?.customers||[];
 const group=key=>tally(rows,key);
 const counts=new Map(group("tier").map(v=>[v.name,v.count]));
 const allGrades=[...new Set([...TIERS,...rows.map(r=>String(r.tier||"待核验"))])];
 const byTier=allGrades.map(name=>{
  const members=rows.filter(r=>String(r.tier||"待核验")===name);
  return {name,count:members.length,share:rows.length?+(members.length/rows.length*100).toFixed(2):0,
   m180:sum(members,"m180"),lifetime:sum(members,"spendLifetime"),
   f180:sum(members,"f180")};
 });
 // Distinguish missing from zero, and never claim the historic labels are audited.
 return {
  generatedAt:snapshot.generatedAt,source:snapshot.source,
  grading:{state:"historical_snapshot_pending_full_net_reconciliation",policy:"2026-11-08"},
  masterTotal:rows.length,tierTotal:byTier.reduce((s,g)=>s+g.count,0),
  tiers:byTier,topCountries:group("country").slice(0,15),
  subscriptions:group("subscription"),quality:group("quality"),
  historical:{m180:sum(rows,"m180"),lifetime:sum(rows,"spendLifetime"),
   f180:sum(rows,"f180"),ordersLifetime:sum(rows,"ordersLifetime")},
  aovBands:{
   thresholdUsd:400,
   high:rows.filter(r=>numeric(r.aov)!==null&&r.aov>=400).length,
   low:rows.filter(r=>numeric(r.aov)!==null&&r.aov<400).length,
   unknown:rows.filter(r=>numeric(r.aov)===null).length
  },
  customerActivity:{
   recent30:rows.filter(r=>numeric(r.rDays)!==null&&r.rDays<=30).length,
   recent90:rows.filter(r=>numeric(r.rDays)!==null&&r.rDays<=90).length,
   over180:rows.filter(r=>numeric(r.rDays)!==null&&r.rDays>180).length,
   unknown:rows.filter(r=>numeric(r.rDays)===null).length
  }
 };
}
module.exports={summarize,TIERS,sum,tally};
