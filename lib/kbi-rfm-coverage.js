"use strict";
// Aggregate-only completeness audit of an already published private KBI index.
// Missing M/R/F is not the same as a zero, and a never-purchaser may have no R.
const valid=n=>typeof n==="number"&&Number.isFinite(n)&&n>=0;
const whole=n=>Number.isSafeInteger(n)&&n>=0;
function audit(rows){
 if(!Array.isArray(rows))throw Error("invalid_customer_index");
 const groups={purchased:{total:0,complete:0,incomplete:0},
  neverPurchased:{total:0,complete:0,incomplete:0},
  unknownOrderCount:{total:0,complete:0,incomplete:0}};
 const missing={m180:0,f180:0,rDays:0,allThree:0};
 let complete=0,incomplete=0;
 for(const row of rows){
  const bucket=whole(row.ordersLifetime)?(row.ordersLifetime>0?"purchased":"neverPurchased"):"unknownOrderCount";
  const group=groups[bucket];group.total++;
  const m=!valid(row.m180),f=!whole(row.f180),r=!valid(row.rDays);
  if(!m&&!f&&!r){complete++;group.complete++;continue;}
  incomplete++;group.incomplete++;
  if(m)missing.m180++;
  if(f)missing.f180++;
  if(r)missing.rDays++;
  if(m&&f&&r)missing.allThree++;
 }
 const total=rows.length;
 // Never-purchasers have no meaningful R. Report purchased cohort coverage
 // separately so an absent R for a non-buyer does not inflate the P0 gap.
 const purchasedTotal=groups.purchased.total;
 const purchasedCompletePercent=purchasedTotal
  ?Math.round(groups.purchased.complete/purchasedTotal*10000)/100:null;
 return {total,complete,incomplete,completePercent:total?Math.round(complete/total*10000)/100:null,
  purchasedCompletePercent,missing,groups,purchasedRecordsMissingRfm:groups.purchased.incomplete,
  note:"Counts reflect existing historical M/F/R snapshot completeness, not audited finance or finalized CRM grades."};
}
module.exports={audit};
