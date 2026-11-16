"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {canReuseQa,MAX_QA_AGE_MS}=require("../lib/bi-production-qa-cache");
const now=Date.parse("2026-11-16T02:00:00.000Z");
const deployment="kbi-qa-test-deployment.vercel.app";
const qa={version:5,deploymentId:deployment,ready:true,at:"2026-11-16T01:55:00.000Z"};
const completed={slot:"2026-11-16-morning",complete:true,completedAt:"2026-11-16T01:50:00.000Z"};
const reuse=(p,b,t=now,id=deployment)=>canReuseQa(p,b,t,id);

test("reuses an accepted QA report only after the current index build completed",()=>{
  assert.equal(reuse(qa,completed,now),true);
  assert.equal(reuse(qa,{...completed,completedAt:"2026-11-16T01:57:00.000Z"},now),false);
  assert.equal(reuse(qa,{...completed,slot:"2026-11-16-noon",completedAt:"2026-11-16T01:57:00.000Z"},now),false);
});

test("blocks cached QA reuse while the next index build is running or metadata is absent",()=>{
  assert.equal(reuse(qa,{...completed,complete:false},now),false);
  assert.equal(reuse(qa,null,now),false);
  assert.equal(reuse(qa,{...completed,slot:""},now),false);
  assert.equal(reuse(qa,{...completed,completedAt:null},now),false);
});

test("invalid, failed, expired, or future-dated QA is never cached",()=>{
  assert.equal(reuse({...qa,ready:false},completed,now),false);
  assert.equal(reuse({...qa,version:3},completed,now),false);
  assert.equal(reuse({...qa,at:"not-a-date"},completed,now),false);
  assert.equal(reuse({...qa,at:new Date(now+1000).toISOString()},completed,now),false);
  assert.equal(reuse({...qa,at:new Date(now-MAX_QA_AGE_MS).toISOString()},completed,now),false);
  assert.equal(reuse(qa,completed,NaN),false);
});

test("QA from a different deployment never authorizes a new production build",()=>{
  assert.equal(reuse(qa,completed,now,"new-build.vercel.app"),false);
  assert.equal(reuse(qa,completed,now,""),false);
  assert.equal(reuse({...qa,deploymentId:""},completed),false);
  assert.equal(reuse({...qa,version:4},completed),false);
  assert.equal(reuse({...qa,deploymentId:"new-build.vercel.app"},completed),false);
});
