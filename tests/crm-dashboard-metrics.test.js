"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {result}=require("../lib/crm-dashboard-metrics");
const NOW=new Date("2026-11-08T00:00:00Z");
const c=(id,fields)=>({fields:{"Shopify客户ID":"gid://shopify/Customer/"+id,"客户数据状态":"有效",...fields}});
test("dashboard avoids falsely reporting partial net sales as full sales",()=>{
 const a=result([c(1,{"邮件订阅状态":"已订阅","CRM等级":"S+","近180天净消费":3000,"近180天有效订单数":5,"最近购买距今天数R":20,"RFM价值分群":"重要价值用户"}),c(2,{"邮件订阅状态":"未订阅","CRM等级":"待核验"})],[],{asOf:NOW});
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

test("dashboard ignores stale Feishu grades and preserves independent RFM evidence",()=>{
 const fields=(spend,orders,f,r,old)=>({"历史累计消费":spend,"历史订单数":orders,"近180天有效订单数":f,"最近购买距今天数R":r,"CRM等级":old,"近180天净消费":50,"RFM价值分群":"一般发展用户","客户关系健康度":"健康"});
 const d=result([c(1,fields(3000,1,1,5,"B")),c(2,fields(0,2,0,300,"沉睡")),c(3,fields(2000,2,0,300,"S")),c(4,fields(null,1,1,2,"S+"))],[],{asOf:NOW});
 assert.equal(d.value.crm_grades["S+"],1);
 assert.equal(d.value.crm_grades["沉睡"],1);
 assert.equal(d.value.crm_grades["待核验"],2);
 assert.equal(d.value.crm_grades.B,0);
 assert.equal(d.value.crm_grades["基础客户"],undefined);
 assert.equal(d.relationship.matrix["S+"]["健康"],1);
 assert.equal(d.value.rfm_groups["一般发展用户"],4);
 assert.equal(d.value.known_net_sales_subtotal_usd,200);
 assert.equal(d.grading.state,"historical_snapshot_pending_full_net_reconciliation");
});
