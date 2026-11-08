"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const handler=require("../api/bi-ingestion-status");
const saved={...process.env};
const originalFetch=global.fetch;
function setup(){
 process.env.KBI_ACCESS_TOKEN="kbi-ingestion-testing-secret-long-enough";
 process.env.SHOPIFY_SHOP_DOMAIN="fake.myshopify.com";
 process.env.SHOPIFY_ADMIN_ACCESS_TOKEN="synthetic-token";
 delete process.env.GMAIL_CLIENT_ID;
 delete process.env.GMAIL_CLIENT_SECRET;
 delete process.env.GMAIL_REFRESH_TOKEN;
}
function req(auth=true){return {method:"GET",headers:{authorization:"Bearer "+(auth?"kbi-ingestion-testing-secret-long-enough":"bad")}};}
function response(){return {statusCode:200,jsonBody:null,setHeader(){},status(v){this.statusCode=v;return this;},json(x){this.jsonBody=x;return this;}};}
test.after(()=>{global.fetch=originalFetch;for(const k of ["KBI_ACCESS_TOKEN","SHOPIFY_SHOP_DOMAIN","SHOPIFY_ADMIN_ACCESS_TOKEN","GMAIL_CLIENT_ID","GMAIL_CLIENT_SECRET","GMAIL_REFRESH_TOKEN"])saved[k]===undefined?delete process.env[k]:process.env[k]=saved[k];});
test("denies unauthorized access without accessing provider",async()=>{
 setup();let calls=0;global.fetch=async()=>{calls++;throw Error("unexpected");};
 const r=response();await handler(req(false),r);
 assert.equal(r.statusCode,401);assert.equal(calls,0);
});
test("shows full-history permission gap without misrepresenting bulk state",async()=>{
 setup();global.fetch=async()=>({ok:true,status:200,json:async()=>({data:{
  currentAppInstallation:{accessScopes:[{handle:"read_orders"},{handle:"read_products"}]},
  bulkOperations:{nodes:[{id:"gid://shopify/BulkOperation/1",status:"RUNNING",objectCount:"12",createdAt:"2026-11-08T10:00:00Z"}]}
 }})});
 const r=response();await handler(req(),r);
 assert.equal(r.statusCode,200);
 assert.equal(r.jsonBody.shopify.permissions.read_all_orders,false);
 assert.equal(r.jsonBody.shopify.fullHistoryReady,false);
 assert.equal(r.jsonBody.shopify.bulk[0].status,"RUNNING");
 assert.equal(r.jsonBody.audit.status,"not_verified");
});
test("no source credentials returns explicit not-configured status",async()=>{
 setup();delete process.env.SHOPIFY_SHOP_DOMAIN;
 let calls=0;global.fetch=async()=>{calls++;throw Error("unexpected");};
 const r=response();await handler(req(),r);
 assert.equal(r.statusCode,200);
 assert.equal(r.jsonBody.shopify.configured,false);
 assert.equal(calls,0);
});
