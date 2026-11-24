"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {runPages}=require("../lib/crm-gmail-delta-page");
function fixture(){
 let clock=0,disk=null,listed=0;
 const writes=[],cp={cursor:"legacy",completed:false,counters:{}};
 const args={checkpoint:cp,deadline:10,maxPages:4,now:()=>clock,
 list:async cursor=>{listed++;assert.equal(cursor,"legacy");return {messages:[{id:"a"},{id:"b"},{id:"c"}]};},
 process:async id=>{writes.push(id);clock+=6;return "created";},
 save:async value=>{disk=JSON.parse(JSON.stringify(value));},
 done:value=>{value.completed=true;value.cursor=null;}};
 return {cp,args,writes,get disk(){return disk;},get listed(){return listed;},set clock(v){clock=v;}};
}
test("deadline persists item offset without advancing legacy page cursor",async()=>{
 const f=fixture();const r=await runPages(f.args);
 assert.deepEqual(r,{pages:0,messages:2});assert.equal(f.disk.cursor,"legacy");
 assert.equal(f.disk.pendingPage.offset,2);assert.equal(f.disk.completed,false);
 f.clock=0;await runPages({...f.args,checkpoint:f.disk});
 assert.deepEqual(f.writes,["a","b","c"]);assert.equal(f.listed,1);
 assert.equal(f.disk.completed,true);assert.equal(f.disk.pendingPage,undefined);
 assert.equal(f.disk.counters.accepted,3);assert.equal(f.disk.counters.pages,1);
});
test("item failure preserves last durable offset",async()=>{
 const f=fixture();await assert.rejects(runPages({...f.args,process:async id=>{
 if(id==="b")throw Error("temporary");return "excluded";}}),/temporary/);
 assert.equal(f.disk.pendingPage.offset,1);assert.equal(f.disk.cursor,"legacy");
 assert.equal(f.disk.counters.scanned,1);assert.equal(f.disk.completed,false);
});
test("invalid pending page fails closed",async()=>{
 const f=fixture();f.cp.pendingPage={cursor:"wrong",ids:["a"],offset:0,next:null};
 await assert.rejects(runPages(f.args),/Invalid pending/);assert.equal(f.writes.length,0);
});
test("empty page with next token is not completed",async()=>{
 const f=fixture();await runPages({...f.args,maxPages:1,list:async()=>({messages:[],nextPageToken:"next"})});
 assert.equal(f.disk.cursor,"next");assert.equal(f.disk.completed,false);
 assert.equal(f.disk.counters.pages,1);
});
test("expired deadline does not list or write",async()=>{
 const f=fixture();f.clock=10;assert.deepEqual(await runPages(f.args),{pages:0,messages:0});
 assert.equal(f.listed,0);assert.equal(f.disk,null);
});
test("failed post-write checkpoint retries same source ID",async()=>{
 const f=fixture();let saves=0;
 await assert.rejects(runPages({...f.args,save:async value=>{
 if(++saves===2)throw Error("blob failure");await f.args.save(value);}}),/blob failure/);
 assert.equal(f.disk.pendingPage.offset,0);f.clock=0;
 await runPages({...f.args,checkpoint:f.disk,process:async id=>id==="a"?"duplicates":"created"});
 assert.equal(f.disk.counters.duplicates,1);assert.equal(f.disk.completed,true);
});
