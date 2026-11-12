"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {result}=require("../lib/crm-dashboard-metrics");
const NOW=new Date("2026-11-08T00:00:00Z");
const c=(id,fields)=>({fields:{"Shopify客户ID":"gid://shopify/Customer/"+id,"客户数据状态":"有效",...fields}});
test("dashboard avoids falsely reporting partial net sales as full sales",()=>{
 const a=result([c(1,{"邮件订阅状态":"已订阅","CRM等级":"S+","历史累计消费":3000,"历史订单数":5,"近180天净消费":3000,"近180天有效订单数":5,"最近购买距今天数R":20,"RFM价值分群":"重要价值用户"}),c(2,{"邮件订阅状态":"未订阅","CRM等级":"待核验"})],[],{asOf:NOW});
 assert.equal(a.value.customer_count,2);
 assert.equal(a.value.net_sales_180d_usd,null);
 assert.equal(a.value.known_net_sales_subtotal_usd,3000);
 assert.equal(a.quality.mrf_coverage.ratio,50);
 assert.equal(a.value.subscription.未订阅,1);
});
test("duplicate customer id excluded from dashboard",()=>{
 const x=result([c(1,{"CRM等级":"B"}),c(1,{"CRM等级":"S"})],[],{asOf:NOW});
 assert.equal(x.quality.valid_customers,1);
 assert.equal(x.quality.duplicate_customer_ids,1);
});
test("service uses only records inside selected window",()=>{
 const x=result([],[{fields:{"记录时间":Date.parse("2026-11-01"),"任务状态":"待处理","处理时长小时":2}},{fields:{"记录时间":Date.parse("2026-01-01"),"任务状态":"已完成"}}],{asOf:NOW});
 assert.equal(x.service.records_30d,1);
 assert.equal(x.service.unresolved,1);
});
