"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {liveCRMScan,queryRows}=require("../api/bi-customers-v2");
const previousFetch=global.fetch;
const previous={FEISHU_APP_ID:process.env.FEISHU_APP_ID,FEISHU_APP_SECRET:process.env.FEISHU_APP_SECRET};
test.after(()=>{
 global.fetch=previousFetch;
 for(const [k,v] of Object.entries(previous))if(v===undefined)delete process.env[k];else process.env[k]=v;
});
function fakeResponse(data){return {ok:true,status:200,json:async()=>data};}
test("bootstraps all 1001 existing Feishu CRM rows and supports global grade filtering",async()=>{
 process.env.FEISHU_APP_ID="synthetic";
 process.env.FEISHU_APP_SECRET="synthetic";
 let pages=0,auth=0;
 global.fetch=async url=>{
  if(String(url).includes("tenant_access_token")){auth++;return fakeResponse({code:0,tenant_access_token:"synthetic-token"});}
  if(String(url).includes("/records?")){
   const page=pages++,count=page===2?1:500;
   const base=page*500;
   return fakeResponse({code:0,data:{
    has_more:page<2,page_token:page<2?"cursor-"+(page+1):undefined,
    items:Array.from({length:count},(_,i)=>({record_id:"record-"+(base+i),fields:{
     "Shopify客户ID":"gid://shopify/Customer/"+(10000+base+i),
     "历史累计消费":3200,"历史订单数":6,"CRM等级":(base+i)%2?"S+":"B","近180天净消费":(base+i)%2?3200:80,
     "近180天有效订单数":(base+i)%2?5:1,"最近购买距今天数R":(base+i)%2?4:90,
     "客户姓名":"Customer "+(base+i),"邮箱":"c"+(base+i)+"@example.test",
     "客户数据状态":"有效"
    }}))
   }});
  }
  throw Error("unexpected endpoint");
 };
 const d=await liveCRMScan();
 assert.equal(d.total,1001);
 assert.equal(d.customers.length,1001);
 assert.equal(queryRows(d.customers,{tier:"S+",minM:3000}).length,500);
 assert.equal(pages,3);assert.equal(auth,1);
});
test("missing last page fails safely rather than delivering partial customer list",async()=>{
 process.env.FEISHU_APP_ID="synthetic";
 process.env.FEISHU_APP_SECRET="synthetic";
 global.fetch=async url=>{
  if(String(url).includes("tenant_access_token"))return fakeResponse({code:0,tenant_access_token:"synthetic"});
  return fakeResponse({code:0,data:{items:[],has_more:true,page_token:"p"}});
 };
 await assert.rejects(liveCRMScan(),/crm_snapshot_incomplete/);
});
