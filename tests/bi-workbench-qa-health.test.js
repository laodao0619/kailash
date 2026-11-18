"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const source=fs.readFileSync(path.join(__dirname,"../public/bi/workbench-modules.js"),"utf8");
const checks={list:true,sort:true,tier:true,customer360:true,productHistory:true,mailSummary:true,noteRead:true};

async function renderHealth(productionQA){
 const nodes=new Map();
 const $=id=>{
  if(!nodes.has(id))nodes.set(id,{innerHTML:"",textContent:"",value:"",disabled:false});
  return nodes.get(id);
 };
 const sandbox={
  document:{visibilityState:"visible",addEventListener(){},querySelectorAll(){return[];}},
  setInterval(){},
 };
 vm.runInNewContext(source,sandbox,{filename:"workbench-modules.js"});
 const ctx={
  $,state:{token:""},request:async(url)=>{
   assert.equal(url,"/api/bi-index-health");
   return {ready:true,snapshot:{total:10866},productionQA};
  },
  load(){},esc:v=>String(v??""),n:v=>String(v),
  money:v=>String(v),fmt:v=>String(v),safeUrl:()=>"",
 };
 await sandbox.KBIWorkbenchModules.initialize(ctx).health();
 return $("system-health").innerHTML;
}
test("stale QA never paints green even if every old check is true",async()=>{
 const html=await renderHealth({ready:true,currentForSnapshot:false,checks});
 assert.match(html,/索引QA有效性/);
 assert.match(html,/待重新验证/);
 assert.match(html,/旧QA不得用于新索引/);
 assert.doesNotMatch(html,/<strong>通过<\/strong>/);
 assert.doesNotMatch(html,/<strong>读取通过<\/strong>/);
});
test("current QA shows only supported program checks as passed",async()=>{
 const html=await renderHealth({ready:true,currentForSnapshot:true,checks});
 assert.match(html,/与当前索引一致/);
 assert.match(html,/<strong>通过<\/strong>/);
 assert.match(html,/<strong>读取通过<\/strong>/);
 assert.match(html,/业务验收另行完成/);
});
test("missing or failed QA fails closed for all customer checks",async()=>{
 for(const result of [null,{ready:false,currentForSnapshot:true,checks},{ready:true,checks}]){
  const html=await renderHealth(result);
  assert.match(html,/待重新验证/);
  assert.doesNotMatch(html,/<strong>通过<\/strong>/);
 }
});
test("current QA does not falsely pass an absent individual check",async()=>{
 const html=await renderHealth({ready:true,currentForSnapshot:true,checks:{...checks,tier:false}});
 assert.match(html,/列表筛选与排序<\/small><strong>待核验<\/strong>/);
});
