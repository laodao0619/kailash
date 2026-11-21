"use strict";
/**
 * Read-only freshness check for Beijing-time CRM reviews.
 * A completed flag from yesterday or an earlier slot is not current success.
 * Never edits, resets, or rewinds private synchronization cursors.
 */
const BEIJING_OFFSET_MS=8*60*60*1000;
const SOURCES=["customers","orders","gmail"];
function expectedWindow(now=new Date()){
 const shifted=new Date(now.getTime()+BEIJING_OFFSET_MS);
 if(!Number.isFinite(shifted.getTime()))throw new TypeError("invalid evaluation time");
 const day=shifted.toISOString().slice(0,10);
 const minute=shifted.getUTCHours()*60+shifted.getUTCMinutes();
 let slot=null,dueTime=null;
 if(minute>=16*60+30){slot="before_close";dueTime="16:30";}
 else if(minute>=14*60){slot="after_store_midnight";dueTime="14:00";}
 else if(minute>=9*60+30){slot="before_work";dueTime="09:30";}
 return {day,slot,dueTime,timeZone:"Asia/Shanghai"};
}
function checkCheckpoint(state,window){
 const checkpointDay=state?.day||null,checkpointSlot=state?.slotKey||null;
 const updatedAt=state?.updatedAt||null;
 let status="not_due";
 if(window.slot){
  if(!state)status="missing";
  else if(checkpointDay!==window.day)status="stale_day";
  else if(!checkpointSlot)status="unverified_slot";
  else if(checkpointSlot!==window.day+"/"+window.slot)status="stale_slot";
  else status=state.completed===true?"completed":"incomplete";
 }
 return {status,checkpointDay,checkpointSlot,updatedAt};
}
function evaluateDailyHealth(checkpoints,now=new Date()){
 const window=expectedWindow(now);
 const sources=Object.fromEntries(SOURCES.map(source=>[source,checkCheckpoint(checkpoints?.[source],window)]));
 return {evaluatedAt:now.toISOString(),...window,
  ready:!!window.slot&&SOURCES.every(source=>sources[source].status==="completed"),
  sources,note:"Read-only latest-slot check; earlier slots and financial records are not revalidated."};
}
module.exports={expectedWindow,checkCheckpoint,evaluateDailyHealth};
