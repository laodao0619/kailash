"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {qaMatchesSnapshot,canReuseQA,REQUIRED_CHECKS}=require("../lib/kbi-qa-freshness");
const qa=()=>({version:4,ready:true,at:"2026-11-22T06:00:00Z",checks:Object.fromEntries(REQUIRED_CHECKS.map(name=>[name,true])),metrics:{total:10930}});
const snapshot=()=>({generatedAt:"2026-11-22T05:45:25Z",total:10930});
const state=()=>({complete:true,completedAt:"2026-11-22T05:45:26Z",records:10930});
test("fresh QA with identical snapshot and passed checks is ready",()=>assert.equal(qaMatchesSnapshot(qa(),snapshot()),true));
test("previous index QA does not verify a newer index",()=>assert.equal(qaMatchesSnapshot({...qa(),at:"2026-11-22T04:10:16Z"},snapshot()),false));
test("QA index count mismatch fails closed",()=>assert.equal(qaMatchesSnapshot({...qa(),metrics:{total:10928}},snapshot()),false));
test("a single failed or missing check fails closed",()=>{assert.equal(qaMatchesSnapshot({...qa(),checks:{list:true,sort:false}},snapshot()),false);assert.equal(qaMatchesSnapshot({...qa(),checks:{}},snapshot()),false)});
test("unknown timestamps or missing metadata cannot yield ready",()=>{assert.equal(qaMatchesSnapshot({...qa(),at:null},snapshot()),false);assert.equal(qaMatchesSnapshot(qa(),{total:10930}),false);assert.equal(qaMatchesSnapshot(null,snapshot()),false)});
test("old QA may be reused only for the same completed snapshot",()=>assert.equal(canReuseQA(qa(),state(),Date.parse("2026-11-22T07:00:00Z")),true));
test("a new completed build invalidates a recent QA run",()=>assert.equal(canReuseQA(qa(),{...state(),completedAt:"2026-11-22T06:30:00Z"},Date.parse("2026-11-22T07:00:00Z")),false));
test("different source row counts invalidate cached QA",()=>assert.equal(canReuseQA(qa(),{...state(),records:10932},Date.parse("2026-11-22T07:00:00Z")),false));
test("an in-flight build is not treated as completed",()=>assert.equal(canReuseQA(qa(),{...state(),complete:false},Date.parse("2026-11-22T07:00:00Z")),false));
test("future-dated and expired QA runs are never reusable",()=>{assert.equal(canReuseQA(qa(),state(),Date.parse("2026-11-22T05:00:00Z")),false);assert.equal(canReuseQA(qa(),state(),Date.parse("2026-11-22T10:00:00Z")),false)});
test("invalid completed checkpoint time prevents reuse",()=>assert.equal(canReuseQA(qa(),{...state(),completedAt:"invalid"},Date.parse("2026-11-22T07:00:00Z")),false));
test("partial legacy QA reports cannot claim readiness",()=>{
 const missing=qa();
 delete missing.checks.mailSummary;
 assert.equal(qaMatchesSnapshot(missing,snapshot()),false);
 assert.equal(canReuseQA(missing,state(),Date.parse("2026-11-22T07:00:00Z")),false);
});
test("all twelve real service checks are required",()=>{
 assert.equal(REQUIRED_CHECKS.length,12);
 for(const name of REQUIRED_CHECKS){
  const partial=qa();
  delete partial.checks[name];
  assert.equal(qaMatchesSnapshot(partial,snapshot()),false,name);
 }
});
test("old QA report versions do not qualify even with identical row count",()=>{
 assert.equal(qaMatchesSnapshot({...qa(),version:3},snapshot()),false);
});
test("unknown failed checks cannot be hidden alongside the full required suite",()=>{
 const partial=qa();
 partial.checks.unexpectedNewCheck=false;
 assert.equal(qaMatchesSnapshot(partial,snapshot()),false);
});
