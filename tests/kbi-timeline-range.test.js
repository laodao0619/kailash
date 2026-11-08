"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const T=require("../public/bi/timeline-range");
const NOW=Date.parse("2026-11-08T16:00:00Z");
const events=[
 {at:"2025-07-11T10:00:00Z",kind:"order"},
 {at:"2026-09-03T10:00:00Z",kind:"order"},
 {at:"2026-10-22T10:00:00Z",kind:"communication"}
];
test("preset windows 30 60 180 360 and all reflect actual event timestamps",()=>{
 for(const days of [30,60,180,360]){
  const w=T.timeWindow(events,String(days),NOW);
  assert.equal(w.end,NOW);
  assert.equal((w.end-w.start)/T.DAY,days);
 }
 const all=T.timeWindow(events,"all",NOW);
 assert(all.start<Date.parse(events[0].at));
 assert(all.end>NOW);
 assert.equal(T.filterEvents(events,T.timeWindow(events,"30",NOW)).length,1);
 assert.equal(T.filterEvents(events,T.timeWindow(events,"180",NOW)).length,2);
});
test("custom date selection includes end of chosen day and rejects reversed range",()=>{
 const w=T.timeWindow(events,"custom",NOW,"2026-09-03","2026-10-22");
 assert.equal(T.filterEvents(events,w).length,2);
 const invalid=T.timeWindow(events,"custom",NOW,"2026-10-22","2026-09-03");
 assert.equal(invalid.preset,"180");
});
test("wheel zoom changes horizontal span and preserves pointer-anchored time",()=>{
 const initial=T.timeWindow(events,"180",NOW);
 const bounds=T.allBounds(events,NOW);
 const focus=initial.start+(initial.end-initial.start)*0.25;
 const narrower=T.zoom(initial,-100,0.25,bounds);
 assert(narrower.end-narrower.start<initial.end-initial.start);
 const newFocus=narrower.start+(narrower.end-narrower.start)*0.25;
 assert(Math.abs(focus-newFocus)<100);
 const wider=T.zoom(narrower,120,0.25,bounds);
 assert(wider.end-wider.start>narrower.end-narrower.start);
});
test("joined series sorts events and accumulates counts without inventing missing dates",()=>{
 const rows=T.cumulativeSeries([
  {at:"2026-10-22T10:00:00Z",qty:2},
  {at:"2026-09-03T10:00:00Z",qty:1}
 ],e=>e.qty);
 assert.deepEqual(rows.map(x=>x.value),[1,3]);
 assert.equal(T.polyline(rows,v=>v.value,v=>v.value),"M1.00 1.00 L3.00 3.00");
});
