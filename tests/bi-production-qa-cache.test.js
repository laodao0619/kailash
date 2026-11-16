"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {canReuseQa,MAX_QA_AGE_MS}=require("../lib/bi-production-qa-cache");
const now=Date.parse("2026-11-16T02:00:00.000Z");
const qa={version:4,ready:true,at:"2026-11-16T01:55:00.000Z"};
const completed={slot:"2026-11-16-morning",complete:true,completedAt:"2026-11-16T01:50:00.000Z"};

test("reuses an accepted QA report only after the current index build completed",()=>{
  assert.equal(canReuseQa(qa,completed,now),true);
  assert.equal(canReuseQa(qa,{...completed,completedAt:"2026-11-16T01:57:00.000Z"},now),false);
  assert.equal(canReuseQa(qa,{...completed,slot:"2026-11-16-noon",completedAt:"2026-11-16T01:57:00.000Z"},now),false);
});

test("blocks cached QA reuse while the next index build is running or metadata is absent",()=>{
  assert.equal(canReuseQa(qa,{...completed,complete:false},now),false);
  assert.equal(canReuseQa(qa,null,now),false);
  assert.equal(canReuseQa(qa,{...completed,slot:""},now),false);
  assert.equal(canReuseQa(qa,{...completed,completedAt:null},now),false);
});

test("invalid, failed, expired, or future-dated QA is never cached",()=>{
  assert.equal(canReuseQa({...qa,ready:false},completed,now),false);
  assert.equal(canReuseQa({...qa,version:3},completed,now),false);
  assert.equal(canReuseQa({...qa,at:"not-a-date"},completed,now),false);
  assert.equal(canReuseQa({...qa,at:new Date(now+1000).toISOString()},completed,now),false);
  assert.equal(canReuseQa({...qa,at:new Date(now-MAX_QA_AGE_MS).toISOString()},completed,now),false);
  assert.equal(canReuseQa(qa,completed,NaN),false);
});
