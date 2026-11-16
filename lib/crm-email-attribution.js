"use strict";
const WINDOW_MS=7*86400000;
const POLICY={version:'crm-edm-v2',windowDays:7,model:'last_non_direct_click',periodBasis:'order_processed_at',revenueBasis:'current_total_price_shop_currency',directVisitsOverride:false};
function isEmail(v){
 const u=v.utmParameters||{};
 return /^(email|e-mail)$/i.test(u.medium||'')||/^email$/i.test(v.source||'')||
  /^(shopify_email|klaviyo|mailchimp|omnisend|newsletter|brevo|email)$/i.test(u.source||'')||v.sourceType==='NEWSLETTER';
}
function direct(v){const u=v.utmParameters||{};return !u.source&&!u.medium&&/^(direct|\(direct\))$/i.test(v.source||'');}
function attribute(o){
 if(o.test||o.cancelledAt||!['PAID','PARTIALLY_PAID','PARTIALLY_REFUNDED'].includes(o.displayFinancialStatus))return {status:'excluded'};
 const at=Date.parse(o.processedAt),j=o.customerJourneySummary;
 if(!Number.isFinite(at)||!j?.ready||!j.moments||j.moments.pageInfo?.hasNextPage)return {status:'unverified',reason:'journey_incomplete'};
 const visits=new Map();
 for(const v of j.moments.nodes||[]){
  const t=Date.parse(v.occurredAt);
  if(Number.isFinite(t)&&t<=at&&at-t<=WINDOW_MS&&!direct(v))visits.set(v.id||String(t)+v.source,v);
 }
 const sorted=[...visits.values()].sort((a,b)=>Date.parse(b.occurredAt)-Date.parse(a.occurredAt));
 const last=sorted[0];if(!last)return {status:'not_email'};
 if(sorted.some(v=>v!==last&&v.occurredAt===last.occurredAt&&isEmail(v)!==isEmail(last)))return {status:'unverified',reason:'ambiguous_click'};
 if(!isEmail(last))return {status:'not_email'};
 const money=o.currentTotalPriceSet?.shopMoney;
 if(!money||money.amount==null||!Number.isFinite(Number(money.amount)))return {status:'unverified',reason:'amount_unknown'};
 const index=j.customerOrderIndex;
 return {status:'email',id:o.id,customerId:o.customer?.id||null,processedAt:o.processedAt,
  clickedAt:last.occurredAt,platform:last.utmParameters?.source||'email_unspecified',campaign:last.utmParameters?.campaign||'未标记活动',
  customerType:index===1?'new':Number.isInteger(index)&&index>1?'returning':'unknown',
  sales:Number(money.amount),currency:money.currencyCode};
}
function summarizeOrders(orders,start,end,timezone,currency,complete=true){
 const {localDay}=require('./crm-period-report');
 const selected=orders.filter(o=>{const day=localDay(o.processedAt,timezone);return day>=start&&day<=end;});
 const results=[...new Map(selected.map(o=>[o.id,o])).values()].map(attribute);
 const attributed=results.filter(r=>r.status==='email'&&r.currency===currency);
 const unknown=results.filter(r=>r.status==='unverified'||r.status==='email'&&(r.currency!==currency||!r.customerId||r.customerType==='unknown')).length;
 const set=items=>new Set(items.map(o=>o.customerId).filter(Boolean)).size;
 const sum=items=>Math.round(items.reduce((a,o)=>a+o.sales,0)*100)/100;
 const breakdown=new Map();
 for(const o of attributed){const k=JSON.stringify([o.platform,o.campaign,o.customerType]);const a=breakdown.get(k)||{platform:o.platform,campaign:o.campaign,customerType:o.customerType,orders:0,sales:0,ids:new Set()};a.orders++;a.sales+=o.sales;if(o.customerId)a.ids.add(o.customerId);breakdown.set(k,a);}
 return {buyers:set(attributed),newBuyers:set(attributed.filter(x=>x.customerType==='new')),returningBuyers:set(attributed.filter(x=>x.customerType==='returning')),
  emailSales:sum(attributed),emailNewSales:sum(attributed.filter(x=>x.customerType==='new')),emailReturningSales:sum(attributed.filter(x=>x.customerType==='returning')),
  emailUnknownSales:sum(attributed.filter(x=>x.customerType==='unknown')),emailOrders:attributed.length,
  attributionCoverage:{scanned:selected.length,unverified:unknown,complete:complete&&unknown===0,scope:'Shopify已记录访问，不代表未接入平台的全部点击'},
  breakdown:[...breakdown.values()].map(({ids,...a})=>({...a,buyers:ids.size,sales:Math.round(a.sales*100)/100}))};
}
module.exports={POLICY,WINDOW_MS,isEmail,direct,attribute,summarizeOrders};
