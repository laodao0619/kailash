"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {auditCaseContentWindow}=require("../lib/crm-case-content-window");
const p="crm-cases/v1/events/";
const blob=n=>({pathname:p+n+".json"});

function fixture(pages){
 const calls=[];
 const listPage=async opts=>{calls.push(opts);const cursor=opts.cursor;
   const index=cursor===undefined?0:Number(cursor.replace("page-",""));
   const arr=pages[index] || [];
   return {blobs:arr.map(blob),hasMore:index<pages.length-1,
     ...(index<pages.length-1?{cursor:"page-"+(index+1)}:{})};
 };
 return {listPage,calls};
}

test("audits bounded pages, keeps customer fields private and never claims global coverage", async()=>{
 const f=fixture([["a","b"],["c"],["d"]]);
 const result=await auditCaseContentWindow({listPage:f.listPage,pageSize:2,maxPages:2,
   readRecord:async x=>({eventId:x,customerEmail:"secret@example.com",originalExcerpt:"private text"})});
 assert.equal(result.inspectedPages,2);
 assert.equal(result.inspectedObjects,3);
 assert.equal(result.hasMore,true);
 assert.equal(result.nextCursor,"page-2");
 assert.equal(result.reachedListingEnd,false);
 assert.equal(result.withinWindowDuplicateCheckPassed,true);
 assert.equal(result.fullArchiveContentVerified,false);
 assert.equal(result.sourceSnapshotConsistencyVerified,false);
 assert.equal(result.checkpointAdvanced,false);
 assert.match(result.windowFingerprint,/^[a-f0-9]{64}$/);
 assert.equal(JSON.stringify(result).includes("secret"),false);
 assert.equal(f.calls.length,2);
 assert(f.calls.every(c=>c.access==="private"));
});

test("final page may be reached but cannot assert a stable archive snapshot",async()=>{
 const f=fixture([["a"],["b"]]);
 const result=await auditCaseContentWindow({listPage:f.listPage,pageSize:1,maxPages:3,
   readRecord:async x=>({eventId:x})});
 assert.equal(result.inspectedPages,2);
 assert.equal(result.hasMore,false);
 assert.equal(result.reachedListingEnd,true);
 assert.equal(result.nextCursor,null);
 assert.equal(result.fullArchiveContentVerified,false);
});

test("repeated event across distinct pages fails closed",async()=>{
 const f=fixture([["a"],["b"]]);
 await assert.rejects(auditCaseContentWindow({listPage:f.listPage,pageSize:1,
   readRecord:async()=>({eventId:"gmail:duplicate"})}),/repeated event/);
});

test("repeated paths across pages fail closed",async()=>{
 const f=fixture([["a"],["a"]]);
 await assert.rejects(auditCaseContentWindow({listPage:f.listPage,pageSize:1,
   readRecord:async x=>({eventId:x})}),/repeated archive path/);
});

test("cursor cycles cannot skip archive windows",async()=>{
 let n=0;
 await assert.rejects(auditCaseContentWindow({pageSize:1,maxPages:3,
   listPage:async()=>({blobs:[blob(++n)],hasMore:true,cursor:"a"}),
   readRecord:async x=>({eventId:x})}),/listing incomplete|pagination cycle/);
});

test("malformed parameters reject without calling provider",async()=>{
 for(const args of [{pageSize:101},{pageSize:0},{maxPages:4},{maxPages:0},
    {cursor:"a\nattack"}]) {
   let calls=0;
   await assert.rejects(auditCaseContentWindow({listPage:async()=>{calls++;return{blobs:[],hasMore:false}},
      readRecord:async()=>({}),...args}));
   assert.equal(calls,0);
 }
});

test("unreadable records and provider errors do not return partial success",async()=>{
 const f=fixture([["a","b"]]);
 await assert.rejects(auditCaseContentWindow({listPage:f.listPage,pageSize:2,
    readRecord:async x=> x.includes("b")?null:({eventId:x})}),/unreadable/);
 await assert.rejects(auditCaseContentWindow({listPage:f.listPage,pageSize:2,
    readRecord:async()=>{throw Error("403 private event");}}),/403/);
});
