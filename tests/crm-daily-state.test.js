"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {cycle,done}=require("../lib/crm-daily-state");
const at="2026-11-08T12:00:00.000Z";
test("first daily cycle starts with bounded 48h delta, never full import",()=>{
 const v=cycle(null,new Date(at));
 assert.equal(v.day,"2026-11-08");
 assert.equal(v.windowStart,"2026-11-06T11:00:00.000Z");
 assert.equal(v.cursor,null);
 assert.equal(v.completed,false);
});
test("same-day completed run is not rerun or cursor reset",()=>{
 const v=done(cycle(null,new Date(at)),new Date("2026-11-08T12:15:00Z"));
 assert.equal(cycle(v,new Date("2026-11-08T19:00:00Z")),v);
});
test("next day starts from previous completion minus 1h safety overlap",()=>{
 const v=done(cycle(null,new Date(at)),new Date("2026-11-08T12:15:00Z"));
 const next=cycle(v,new Date("2026-11-09T08:00:00Z"));
 assert.equal(next.windowStart,"2026-11-08T11:15:00.000Z");
 assert.equal(next.cursor,null);
 assert.equal(next.counters.scanned,0);
});
test("unfinished run retains original cursor and window after midnight",()=>{
 const v=cycle(null,new Date(at));v.cursor="opaque-shopify-next-page";
 const next=cycle(v,new Date("2026-11-11T00:00:00Z"));
 assert.equal(next,v);
 assert.equal(next.cursor,"opaque-shopify-next-page");
});
