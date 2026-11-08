"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {SEGMENTS,segment,grade}=require("../lib/crm-segmentation");
test("eight distinct RFM groups",()=>{
 assert.equal(Object.keys(SEGMENTS).length,8);
 assert.equal(new Set(Object.values(SEGMENTS)).size,8);
 for(const [code,label] of Object.entries(SEGMENTS)){
  const actual=segment({r:code[0]==="H"?30:120,f:code[1]==="H"?3:1,m:code[2]==="H"?1000:100});
  assert.equal(actual.segment,label);assert.equal(actual.code,code);
 }
});
test("missing order values cannot become low value",()=>{
 assert.equal(segment({m:null,r:30,f:2}).verified,false);
 assert.equal(grade({m:null,r:30,f:2,lifetimeOrders:4}).grade,"待核验");
});
test("CRM grades require every threshold",()=>{
 assert.equal(grade({m:3100,r:40,f:5,lifetimeOrders:5}).grade,"S+");
 assert.equal(grade({m:3100,r:40,f:1,lifetimeOrders:5}).grade,"B");
 assert.equal(grade({m:3100,r:190,f:5,lifetimeOrders:5}).grade,"沉睡");
 assert.equal(grade({m:0,r:0,f:0,lifetimeOrders:0}).grade,"从未购买");
});
