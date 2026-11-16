"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {mock}=require("node:test");
const feishu=require("../lib/crm-feishu");

test("Feishu identity search uses a seven-second abortable request",async()=>{
 const controller=new AbortController();
 let requestedMs,observedSignal,called=0;
 const timeout=mock.method(AbortSignal,"timeout",ms=>{
  requestedMs=ms;
  return controller.signal;
 });
 const fetchStub=mock.method(globalThis,"fetch",async(_url,opts)=>{
  called++;
  observedSignal=opts.signal;
  return {ok:true,status:200,json:async()=>({code:0,data:{items:[],has_more:false}})};
 });
 try{
  const found=await feishu.findBy("test-tenant","test-table","Shopify客户ID",
   "gid://shopify/Customer/123");
  assert.deepEqual(found,[]);
  assert.equal(called,1);
  assert.equal(requestedMs,7000);
  assert.equal(observedSignal,controller.signal);
 }finally{
  fetchStub.mock.restore();
  timeout.mock.restore();
 }
});

test("Feishu identity-search timeout fails closed instead of treating a failed search as no matches",async()=>{
 let called=0;
 const fetchStub=mock.method(globalThis,"fetch",async(_url,opts)=>{
  called++;
  assert.ok(opts.signal instanceof AbortSignal);
  throw Object.assign(new Error("synthetic request timeout"),{name:"TimeoutError"});
 });
 try{
  await assert.rejects(
   feishu.findBy("test-tenant","test-table","Shopify客户ID",
    "gid://shopify/Customer/123"),
   /synthetic request timeout/
  );
  assert.equal(called,1);
 }finally{fetchStub.mock.restore();}
});
