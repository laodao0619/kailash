"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {isQaCurrentForSnapshot,canReuseQa}=require("../lib/bi-qa-freshness");
const qa={version:4,ready:true,at:"2026-11-17T00:00:00.000Z"};
const build={complete:true,completedAt:"2026-11-16T23:59:59.000Z"};
test("QA at or after snapshot publication is current",()=>{
 assert.equal(isQaCurrentForSnapshot(qa,"2026-11-17T00:00:00.000Z"),true);
 assert.equal(isQaCurrentForSnapshot(qa,"2026-11-16T23:00:00.000Z"),true);
});
test("success from prior snapshot does not validate new index",()=>{
 assert.equal(isQaCurrentForSnapshot(qa,"2026-11-17T01:20:25.031Z"),false);
 assert.equal(canReuseQa(qa,{complete:true,completedAt:"2026-11-17T01:20:25.264Z"},Date.parse("2026-11-17T02:00:00Z")),false);
});
test("fresh verified QA can be reused for at most four hours",()=>{
 const at=Date.parse(qa.at);
 assert.equal(canReuseQa(qa,build,at+60_000),true);
 assert.equal(canReuseQa(qa,build,at+4*60*60*1000),false);
 assert.equal(canReuseQa(qa,build,at-1),false);
});
test("uncompleted build cannot be treated as verified",()=>{
 assert.equal(canReuseQa(qa,{complete:false,completedAt:build.completedAt},Date.parse(qa.at)+1000),false);
 assert.equal(canReuseQa(qa,{},Date.parse(qa.at)+1000),false);
});
test("failed and legacy QA are never accepted",()=>{
 const at=Date.parse(qa.at);
 assert.equal(isQaCurrentForSnapshot({...qa,ready:false},qa.at),false);
 assert.equal(canReuseQa({...qa,ready:false},build,at+1000),false);
 assert.equal(canReuseQa({...qa,version:3},build,at+1000),false);
});
test("missing or malformed timestamps fail closed",()=>{
 assert.equal(isQaCurrentForSnapshot({...qa,at:"invalid"},build.completedAt),false);
 assert.equal(isQaCurrentForSnapshot(qa,undefined),false);
 assert.equal(canReuseQa(qa,{complete:true,completedAt:"n/a"},Date.parse(qa.at)+1000),false);
});
