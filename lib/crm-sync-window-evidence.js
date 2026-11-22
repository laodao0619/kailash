"use strict";
/**
 * Observational only: a cron schedule and a successful deployment are not
 * evidence that a source actually completed a Beijing-time synchronization.
 * This module never reads or advances private cursors.
 */
const {slotHistory}=require("./crm-daily-state");
const SOURCE_NAMES=["customers","orders","gmail"];
const GATES=[
 {slot:"before_work",verifyAfter:"09:30"},
 {slot:"after_store_midnight",verifyAfter:"14:00"},
 {slot:"before_close",verifyAfter:"16:30"}
];
const MINUTE=60*1000;
// Only a completion after that source's scheduled Beijing cron start can
// substantiate the window. A mismatched slot label must not turn green.
const EARLIEST_COMPLETION_BEIJING={
 before_work:{customers:"08:50",orders:"08:55",gmail:"09:00"},
 after_store_midnight:{customers:"13:15",orders:"13:20",gmail:"13:25"},
 before_close:{customers:"15:45",orders:"15:50",gmail:"15:55"}
};
function earliestCompletion(day,slot,source){
 const clock=EARLIEST_COMPLETION_BEIJING[slot]?.[source];
 return clock?Date.parse(day+"T"+clock+":00+08:00"):NaN;
}
function summarizeDailyWindows(states,now=new Date()){
 const time=now instanceof Date?now:new Date(now);
 if(!Number.isFinite(time.getTime()))throw Error("Invalid observation time");
 const beijing=new Date(time.getTime()+8*60*MINUTE);
 const day=beijing.toISOString().slice(0,10);
 const localMinutes=beijing.getUTCHours()*60+beijing.getUTCMinutes();
 const seen={};
 for(const source of SOURCE_NAMES){
  seen[source]=new Map();
  for(const snapshot of slotHistory(states?.[source])){
   if(snapshot.day!==day)continue;
   const completedAt=Date.parse(snapshot.completedAt);
   // Future-dated snapshots cannot be evidence of a completed sync now.
   if(!Number.isFinite(completedAt)||completedAt>time.getTime()||
      completedAt<earliestCompletion(day,snapshot.slot,source))continue;
   seen[source].set(snapshot.slot,snapshot);
  }
 }
 let dueCount=0,confirmedCount=0;
 const windows=GATES.map(({slot,verifyAfter})=>{
  const [hour,minute]=verifyAfter.split(":").map(Number);
  const due=localMinutes>=hour*60+minute;
  const sources={};
  for(const source of SOURCE_NAMES){
   const snap=seen[source].get(slot);
   const status=snap?"confirmed":due?"missing_evidence":"not_due";
   if(due){dueCount++;if(status==="confirmed")confirmedCount++;}
   sources[source]={status,completed_at:snap?.completedAt||null};
  }
  return {slot,verification_after_beijing:verifyAfter,sources};
 });
 return {day_beijing:day,observed_at:time.toISOString(),due_checks:dueCount,confirmed_due_checks:confirmedCount,
  all_due_confirmed:dueCount>0&&dueCount===confirmedCount,all_nine_confirmed:dueCount===9&&confirmedCount===9,windows,
  note:"Confirmed means a persisted completed checkpoint for that source and Beijing slot; missing_evidence is not proof the cron failed. Preview READY and prior-day checkpoints are not acceptance."};
}
module.exports={summarizeDailyWindows};
