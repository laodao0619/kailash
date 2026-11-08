"use strict";
const {SEGMENTS}=require("./crm-segmentation");
const GRADES=["S+","S","A","B","基础客户","沉睡","从未购买","待核验"];
const HEALTH=["健康","关注","风险"];
const STATUSES=["待处理","处理中","等待客户","已完成","已取消"];
function cell(v){
 if(typeof v==="number"||typeof v==="string")return v;
 if(Array.isArray(v))return v.map(x=>x?.text||x?.name||"").join("");
 return null;
}
function str(row,key){return String(cell(row?.fields?.[key])??"").trim();}
function num(row,key){const v=cell(row?.fields?.[key]);return v!==null&&v!==""&&Number.isFinite(Number(v))?Number(v):null;}
function date(row,key){const v=cell(row?.fields?.[key]);if(typeof v==="number")return v;const t=Date.parse(v||"");return Number.isFinite(t)?t:null;}
function counts(labels){return Object.fromEntries(labels.map(label=>[label,0]));}
function result(customers,communications,{asOf=new Date(),serviceDays=30}={}){
 const seen=new Set(),grades=counts(GRADES),groups=counts(Object.values(SEGMENTS));
 const health=counts(HEALTH),life={},subscriptions={已订阅:0,未订阅:0,已退订:0,待确认:0,其他:0};
 const matrix=Object.fromEntries(GRADES.map(g=>[g,counts(HEALTH)]));
 let valid=0,duplicate=0,invalid=0,completeMrf=0,partialM=0,completeM=0,knownRfm=0,knownHealth=0,knownLife=0,overdue=0,ownerAssigned=0;
 for(const row of customers){
  const id=str(row,"Shopify客户ID");
  if(!id.startsWith("gid://shopify/Customer/")||str(row,"客户数据状态")!=="有效"){invalid++;continue;}
  if(seen.has(id)){duplicate++;continue;}seen.add(id);valid++;
  const subscription=str(row,"邮件订阅状态");
  subscriptions[subscription in subscriptions?subscription:"其他"]++;
  const grade=str(row,"CRM等级")||"待核验";
  grades[grade in grades?grade:"待核验"]++;
  const m=num(row,"近180天净消费"),f=num(row,"近180天有效订单数"),r=num(row,"最近购买距今天数R");
  if(m!==null){partialM+=m;completeM++;}
  if(m!==null&&f!==null&&r!==null)completeMrf++;
  const rfm=str(row,"RFM价值分群");if(rfm in groups){groups[rfm]++;knownRfm++;}
  const relationship=str(row,"客户关系健康度");
  if(relationship in health){health[relationship]++;matrix[grade in matrix?grade:"待核验"][relationship]++;knownHealth++;}
  const stage=str(row,"客户旅程阶段");if(stage){life[stage]=(life[stage]||0)+1;knownLife++;}
  if(str(row,"负责人"))ownerAssigned++;
  const next=date(row,"建议下一次维护日期");
  if(next!==null&&next<asOf.getTime())overdue++;
 }
 const cutoff=asOf.getTime()-serviceDays*86400000;
 const status=counts(STATUSES),category={},priority={},channels={};
 let serviceTotal=0,withDuration=0,durationSum=0,unresolved=0;
 for(const row of communications){
  const at=date(row,"记录时间");if(at===null||at<cutoff||at>asOf.getTime())continue;
  serviceTotal++;
  const s=str(row,"任务状态");if(s in status)status[s]++;
  if(s!=="已完成"&&s!=="已取消")unresolved++;
  for(const [source,key] of [[category,"问题类别"],[priority,"任务优先级"],[channels,"沟通渠道"]]){
   const v=str(row,key)||"未分类";source[v]=(source[v]||0)+1;
  }
  const duration=num(row,"处理时长小时");if(duration!==null&&duration>=0){withDuration++;durationSum+=duration;}
 }
 const coverage=(n)=>({count:n,total:valid,ratio:valid?Math.round(n/valid*1000)/10:0});
 return {
  as_of:asOf.toISOString(),service_days:serviceDays,
  quality:{valid_customers:valid,invalid_or_unverified:invalid,duplicate_customer_ids:duplicate,mrf_coverage:coverage(completeMrf),rfm_coverage:coverage(knownRfm),health_coverage:coverage(knownHealth),lifecycle_coverage:coverage(knownLife)},
  value:{customer_count:valid,subscription:subscriptions,crm_grades:grades,rfm_groups:groups,lifecycle:life,
   // Never present a partial population subtotal as total 180-day sales.
   net_sales_180d_usd:valid>0&&completeM===valid?Math.round(partialM*100)/100:null,
   known_net_sales_subtotal_usd:Math.round(partialM*100)/100,m_coverage:coverage(completeM)},
  relationship:{health,matrix,overdue_maintenance:overdue,owners_assigned:ownerAssigned,owner_coverage:coverage(ownerAssigned)},
  service:{records_30d:serviceTotal,unresolved,task_status:status,category,priority,channels,
   average_resolution_hours:withDuration?Math.round(durationSum/withDuration*10)/10:null,
   duration_sample:withDuration}
 };
}
module.exports={result,GRADES,HEALTH,STATUSES};
