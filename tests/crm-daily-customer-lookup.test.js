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
