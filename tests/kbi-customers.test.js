"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const handler=require("../api/bi-customers");
const Shopify=require("../lib/crm-shopify");
const oldFetch=global.fetch;
const vars=["KBI_ACCESS_TOKEN","SHOPIFY_SHOP_DOMAIN","SHOPIFY_ADMIN_ACCESS_TOKEN"];
const env=Object.fromEntries(vars.map(k=>[k,process.env[k]]));
function res(){return{code:200,body:null,setHeader(){},status(c){this.code=c;return this;},json(d){this.body=d;return this;}};}
function req(q={},authorized=true){return{method:"GET",query:q,headers:{authorization:"Bearer "+(authorized?"long-enough-kbi-test-token-123456789":"bad")}};}
function setup(){
 process.env.KBI_ACCESS_TOKEN="long-enough-kbi-test-token-123456789";
 process.env.SHOPIFY_SHOP_DOMAIN="fake.myshopify.com";
 process.env.SHOPIFY_ADMIN_ACCESS_TOKEN="test-secret";
}
function fixture(){return{data:{customers:{pageInfo:{hasNextPage:true,endCursor:"cursor-2"},nodes:[{
 id:"gid://shopify/Customer/10000000001",firstName:"Test",lastName:"Customer",
 numberOfOrders:"3",amountSpent:{amount:"179.99",currencyCode:"USD"},
 defaultEmailAddress:{emailAddress:"test@example.test",marketingState:"SUBSCRIBED"},
 defaultAddress:{country:"United States"},lastOrder:{processedAt:"2026-11-06T08:00:00Z"}
}]}}};}
test.after(()=>{global.fetch=oldFetch;for(const k of vars)env[k]===undefined?delete process.env[k]:process.env[k]=env[k];});
test("denies customer PII without token before external access",async()=>{
 setup();let calls=0;global.fetch=()=>{calls++;throw Error("must not fetch");};
 const out=res();await handler(req({},false),out);assert.equal(out.code,401);assert.equal(calls,0);
});
test("returns live Shopify customer page without guessing CRM level",async()=>{
 setup();let captured=null;global.fetch=async(url,opts)=>{
  captured=JSON.parse(opts.body);
  return {ok:true,status:200,json:async()=>fixture()};
 };
 const out=res();await handler(req({q:"test@example.test",cursor:""}),out);
 assert.equal(out.code,200);assert.equal(out.body.source,"Shopify Admin (live)");
 assert.equal(out.body.customers[0].tier,null);
 assert.equal(out.body.customers[0].lifetimeSpend,179.99);
 assert.equal(out.body.nextCursor,"cursor-2");
 assert.equal(out.body.total,null);
 assert.equal(captured.variables.filter,"test@example.test");
});
test("missing customer spending stays unknown",async()=>{
 setup();global.fetch=async()=>({ok:true,status:200,json:async()=>{
  const f=fixture();f.data.customers.nodes[0].amountSpent=null;return f;}});
 const out=res();await handler(req({}),out);
 assert.equal(out.code,200);assert.equal(out.body.customers[0].lifetimeSpend,null);
});
test("rejects excessively large filter before hitting Shopify",async()=>{
 setup();let calls=0;global.fetch=()=>{calls++;throw Error("unexpected");};
 const out=res();await handler(req({q:"x".repeat(200)}),out);
 assert.equal(out.code,400);assert.equal(calls,0);
});
