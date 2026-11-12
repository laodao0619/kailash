"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {findBy}=require("../lib/crm-feishu");

async function withFakeSearch(data,run){
 const original=global.fetch;
 global.fetch=async()=>({ok:true,status:200,json:async()=>({code:0,data})});
 try{await run();}
 finally{global.fetch=original;}
}

test("Feishu exact search accepts an explicit empty list as no matches",async()=>{
 await withFakeSearch({items:[],has_more:false},async()=>{
  assert.deepEqual(await findBy("dummy-token","tblTest","Shopify客户ID","gid://shopify/Customer/1"),[]);
 });
});
test("Feishu exact search returns one valid record",async()=>{
 await withFakeSearch({items:[{record_id:"recABC123"}],has_more:false},async()=>{
  assert.deepEqual(await findBy("dummy-token","tblTest","Shopify客户ID","gid://shopify/Customer/1"),
   [{record_id:"recABC123"}]);
 });
});
test("Feishu missing items never silently turns into a create",async()=>{
 for(const data of [{},{total:0,has_more:false},{items:null},{items:{}}]){
  await withFakeSearch(data,async()=>{
   await assert.rejects(()=>findBy("dummy-token","tblTest","Shopify客户ID","gid://shopify/Customer/1"),
    /Feishu search items missing/);
  });
 }
});
test("Feishu partial search results and invalid record identifiers fail closed",async()=>{
 for(const data of [
  {items:[{record_id:"recABC123"}],has_more:true},
  {items:[{}],has_more:false},
  {items:[{record_id:"  "}],has_more:false},
  {items:[{record_id:25}],has_more:false}
 ]){
  await withFakeSearch(data,async()=>{
   await assert.rejects(()=>findBy("dummy-token","tblTest","Shopify客户ID","gid://shopify/Customer/1"),
    /Feishu search result truncated|Feishu search record identity missing/);
  });
 }
});
