"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const handler=require("../api/bi-overview");
const oldFetch=global.fetch;
const vars=["KBI_ACCESS_TOKEN","SHOPIFY_SHOP_DOMAIN","SHOPIFY_ADMIN_ACCESS_TOKEN"];
const saved=Object.fromEntries(vars.map(k=>[k,process.env[k]]));
function setup(){
 process.env.KBI_ACCESS_TOKEN="long-enough-kbi-overview-test-token";
 process.env.SHOPIFY_SHOP_DOMAIN="fake.myshopify.com";
 process.env.SHOPIFY_ADMIN_ACCESS_TOKEN="test-shopify-token";
}
function req(auth=true){return{method:"GET",query:{},headers:{authorization:"Bearer "+(auth?"long-enough-kbi-overview-test-token":"invalid")}};}
function res(){return{code:200,body:null,setHeader(){},status(code){this.code=code;return this;},json(body){this.body=body;return this;}};}
test.after(()=>{global.fetch=oldFetch;for(const k of vars)saved[k]===undefined?delete process.env[k]:process.env[k]=saved[k];});
test("overview denies unauthorized callers without accessing Shopify",async()=>{
 setup();let calls=0;global.fetch=async()=>{calls++;throw Error("forbidden");};
 const result=res();await handler(req(false),result);
 assert.equal(result.code,401);assert.equal(calls,0);
});
test("overview returns exact Shopify total, not guessed filtered CRM total",async()=>{
 setup();global.fetch=async()=>({ok:true,status:200,json:async()=>({
  data:{customersCount:{count:12934,precision:"EXACT"}}
 })});
 const result=res();await handler(req(),result);
 assert.equal(result.code,200);
 assert.deepEqual(result.body.customers,{count:12934,precision:"EXACT"});
 assert.equal(result.body.revenue.amount,null);
 assert.equal(result.body.rfm.policyVersion,"2026-11-08");
});
