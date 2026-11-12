"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const lookup=require("../lib/crm-daily-customer-lookup");
const ids=Array.from({length:12},(_,i)=>({id:"gid://shopify/Customer/"+(1000+i)}));
test("daily customer lookups run at most three in parallel and return all IDs",async()=>{
 let active=0,peak=0,seen=0;
 const map=await lookup("token",ids,async(_token,_table,field,id)=>{
  assert.equal(field,"Shopify客户ID");active++;peak=Math.max(active,peak);seen++;
  await new Promise(resolve=>setTimeout(resolve,5));active--;
  return [{record_id:"rec-"+id.split("/").at(-1)}];
 },"tblCustomers");
 assert.equal(seen,12);assert.ok(peak>1&&peak<=3);
 assert.equal(map.size,12);
 assert.equal(map.get("gid://shopify/Customer/1000"),"rec-1000");
});
test("new customers can be absent from Feishu without creating placeholder IDs",async()=>{
 const found=await lookup("token",[ids[0],ids[1]],async(_t,_b,_f,id)=>
  id===ids[0].id?[{record_id:"rec-1000"}]:[],"tblCustomers");
 assert.equal(found.size,1);assert.equal(found.has(ids[1].id),false);
});
test("duplicate page identities fail before any external lookup",async()=>{
 let called=0;
 await assert.rejects(()=>lookup("token",[ids[0],ids[0]],async()=>{called++;return [];},"tblCustomers"),/Duplicate or missing/);
 assert.equal(called,0);
});
test("duplicate Feishu matching rows fail the whole page",async()=>{
 await assert.rejects(()=>lookup("token",[ids[0]],async()=>[{record_id:"a"},{record_id:"b"}],"tblCustomers"),/Ambiguous Shopify identity/);
});
test("distinct Shopify IDs cannot resolve to the same Feishu record",async()=>{
 const both=[ids[0],ids[1]];
 await assert.rejects(()=>lookup("token",both,async()=>[{record_id:"shared-record"}],"tblCustomers"),
  /Feishu record matched multiple Shopify customer IDs/);
});
test("invalid Feishu record IDs are rejected before building an upsert map",async()=>{
 await assert.rejects(()=>lookup("token",[ids[0]],async()=>[{record_id:"   "}],"tblCustomers"),/record ID missing/);
 await assert.rejects(()=>lookup("token",[ids[0]],async()=>[{record_id:123}],"tblCustomers"),/record ID missing/);
});
test("a failed lookup rejects the page after in-flight lookups settle",async()=>{
 let pending=0;
 await assert.rejects(()=>lookup("token",ids.slice(0,4),async(_t,_b,_f,id)=>{
  pending++;await new Promise(resolve=>setTimeout(resolve,2));pending--;
  if(id===ids[0].id)throw Error("synthetic search failure");
  return [];
 },"tblCustomers"),/synthetic search failure/);
 assert.equal(pending,0);
});
test("malformed Feishu results or missing record IDs cannot be used for writes",async()=>{
 await assert.rejects(()=>lookup("token",[ids[0]],async()=>null,"tblCustomers"),/Malformed Feishu/);
 await assert.rejects(()=>lookup("token",[ids[0]],async()=>[{}],"tblCustomers"),/record ID missing/);
});

test("rejects malformed Shopify pages before customer writes",()=>{
 const good={nodes:ids.slice(0,2),pageInfo:{hasNextPage:true,endCursor:"next-cursor"}};
 assert.equal(lookup.validatePage(good,"old-cursor"),good);
 const invalid=[
  null,
  {nodes:null,pageInfo:{hasNextPage:false}},
  {nodes:ids,pageInfo:{hasNextPage:"yes",endCursor:"next"}},
  {nodes:[],pageInfo:{hasNextPage:true,endCursor:"next"}},
  {nodes:ids.slice(0,1),pageInfo:{hasNextPage:true,endCursor:null}},
  {nodes:ids.slice(0,1),pageInfo:{hasNextPage:true,endCursor:"  "}},
  {nodes:ids.slice(0,1),pageInfo:{hasNextPage:true,endCursor:"old-cursor"}},
  {nodes:[ids[0],ids[0]],pageInfo:{hasNextPage:false,endCursor:null}},
  {nodes:[{id:"1000"}],pageInfo:{hasNextPage:false,endCursor:null}},
  {nodes:[{}],pageInfo:{hasNextPage:false,endCursor:null}}
 ];
 for(const page of invalid)assert.throws(()=>lookup.validatePage(page,"old-cursor"),/Malformed|pagination/);
});
test("accepts a valid final empty Shopify page without requiring endCursor",()=>{
 const final={nodes:[],pageInfo:{hasNextPage:false,endCursor:null}};
 assert.equal(lookup.validatePage(final,null),final);
});
