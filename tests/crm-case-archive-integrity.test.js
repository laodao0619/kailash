"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {allEvents,PREFIX} = require("../lib/crm-cases");

// Synthetic-only Blob mocks. No Feishu, Gmail or production state is touched.
const blob = name => ({pathname: PREFIX + name + ".json"});
const record = name => ({eventId:"gmail:"+name,caseId:"CASE-ABCDEF123456",receivedAt:"2026-11-23T00:00:00Z"});
test("Case archive reads complete paginated evidence without dropping events",async()=>{
 const calls=[];
 const rows=await allEvents(3,{
  listPage:async ({cursor,access})=>{
   assert.equal(access,"private");
   calls.push(cursor||"first");
   return cursor?{blobs:[blob("c")],hasMore:false}:
     {blobs:[blob("a"),blob("b")],hasMore:true,cursor:"next"};
  },
  readRecord:async path=>record(path.split("/").at(-1).slice(0,-5))
 });
 assert.deepEqual(rows.map(x=>x.eventId),["gmail:a","gmail:b","gmail:c"]);
 assert.deepEqual(calls,["first","next"]);
});
test("Case source evidence cannot disappear when private Blob read fails",async()=>{
 await assert.rejects(allEvents(2,{
  listPage:async()=>({blobs:[blob("ok"),blob("missing")],hasMore:false}),
  readRecord:async path=>path.includes("missing")?null:record("ok")
 }),/Case archive event missing or unreadable/);
 await assert.rejects(allEvents(1,{
  listPage:async()=>({blobs:[blob("unreadable")],hasMore:false}),
  readRecord:async()=>{throw Error("private Blob read failed")}
 }),/private Blob read failed/);
});
test("malformed or partial Blob listing cannot be mistaken for completed archive",async()=>{
 for(const response of [null,{}, {blobs:[],hasMore:null}, {hasMore:false}]) {
  await assert.rejects(allEvents(2,{listPage:async()=>response}),/listing incomplete/);
 }
 await assert.rejects(allEvents(2,{
  listPage:async()=>({blobs:[],hasMore:true,cursor:""})
 }),/pagination invalid/);
});
test("cyclic cursors fail closed rather than looping or advancing Case checkpoint",async()=>{
 await assert.rejects(allEvents(3,{
  listPage:async({cursor})=>({blobs:cursor?[]:[blob("a")],hasMore:true,cursor:"same"}),
  readRecord:async()=>record("a")
 }),/pagination invalid/);
});
test("a bounded window is explicitly not a complete archive claim",async()=>{
 let requested=0;
 const rows=await allEvents(1,{
  listPage:async()=>{requested++;return {blobs:[blob("a"),blob("b")],hasMore:true,cursor:"more"};},
  readRecord:async()=>record("a")
 });
 assert.equal(rows.length,1);
 assert.equal(requested,1);
});
test("wrong archive paths and invalid limits fail closed",async()=>{
 await assert.rejects(allEvents(1001),/scan limit invalid/);
 await assert.rejects(allEvents(0),/scan limit invalid/);
 await assert.rejects(allEvents(1,{
  listPage:async()=>({blobs:[{pathname:"public/customer.json"}],hasMore:false}),
  readRecord:async()=>record("a")
 }),/path invalid/);
});

test("duplicate private Blob path across pages fails closed before Case checkpoint",async()=>{
 await assert.rejects(allEvents(3,{
  listPage:async({cursor})=>cursor
    ?{blobs:[blob("a")],hasMore:false}
    :{blobs:[blob("a"),blob("b")],hasMore:true,cursor:"next"},
  readRecord:async path=>record(path.split("/").at(-1).slice(0,-5))
 }),/Case archive duplicate path/);
});
test("duplicate Gmail event evidence at distinct Blob paths fails closed",async()=>{
 await assert.rejects(allEvents(2,{
  listPage:async()=>({blobs:[blob("a"),blob("b")],hasMore:false}),
  readRecord:async()=>record("same-id")
 }),/Case archive duplicate event/);
});
