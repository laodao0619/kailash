"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),Module=require("node:module");
test("stale exact-range cache returns without querying Shopify; missing preview config fails without upstream calls",async()=>{
 const load=Module._load;let saved={generatedAt:"2020-01-01T00:00:00Z",metrics:{orders:7}},calls=0;
 Module._load=function(id,...args){
  if(id==="@vercel/blob")return {get:async()=>saved?{statusCode:200,stream:(async function*(){yield Buffer.from(JSON.stringify(saved))})()}:null,put:async()=>{}};
  if(id==="../lib/crm-shopify")return {queryShopify:async()=>{calls++;throw Error("must not query")}};
  return load.call(this,id,...args);
 };
 const path=require.resolve("../api/bi-ops-dashboard");delete require.cache[path];let handler;
 try{handler=require(path)}finally{Module._load=load;}
 const old=process.env.KBI_ACCESS_TOKEN,domain=process.env.SHOPIFY_SHOP_DOMAIN;
 process.env.KBI_ACCESS_TOKEN="test-only-credential-long-enough";delete process.env.SHOPIFY_SHOP_DOMAIN;
 const run=async()=>{const res={setHeader(){},status(n){this.code=n;return this},json(x){this.body=x;return this}};await handler({method:"GET",headers:{authorization:"Bearer "+process.env.KBI_ACCESS_TOKEN},query:{start:"2026-11-06",end:"2026-11-12"}},res);return res;};
 try{
  let r=await run();assert.equal(r.code,200);assert.equal(r.body.stale,true);assert.equal(r.body.data.metrics.orders,7);assert.equal(calls,0);
  saved=null;r=await run();assert.equal(r.code,503);assert.equal(r.body.error,"shopify_source_not_configured");assert.equal(calls,0);
 }finally{if(old===undefined)delete process.env.KBI_ACCESS_TOKEN;else process.env.KBI_ACCESS_TOKEN=old;if(domain===undefined)delete process.env.SHOPIFY_SHOP_DOMAIN;else process.env.SHOPIFY_SHOP_DOMAIN=domain;delete require.cache[path];}
});
