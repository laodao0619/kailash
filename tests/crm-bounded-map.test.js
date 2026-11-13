"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {mapBounded}=require("../lib/crm-bounded-map");

test("bounded lookups preserve input order with no more than 3 in flight",async()=>{
  let active=0,peak=0;
  const inputs=Array.from({length:30},(_,i)=>i);
  const output=await mapBounded(inputs,3,async (value)=>{
    active++;peak=Math.max(peak,active);
    await new Promise(resolve=>setImmediate(resolve));
    active--;
    return value*2;
  });
  assert.equal(peak,3);
  assert.deepEqual(output,inputs.map(value=>value*2));
  assert.equal(active,0);
});

test("failed lookup aborts the page and prevents scheduling the rest",async()=>{
  const started=[];
  await assert.rejects(mapBounded([0,1,2,3,4,5,6],2,async value=>{
    started.push(value);
    if (value===0) throw Error("ambiguous CRM identity");
    await new Promise(resolve=>setImmediate(resolve));
    return value;
  }),/ambiguous CRM identity/);
  assert(started.length < 7);
});

test("empty pages and invalid limits are explicit",async()=>{
  assert.deepEqual(await mapBounded([],3,async()=>{throw Error("unexpected");}),[]);
  await assert.rejects(mapBounded([1],0,async()=>1),/Invalid bounded lookup configuration/);
  await assert.rejects(mapBounded("not array",3,async()=>1),/Invalid bounded lookup configuration/);
});
