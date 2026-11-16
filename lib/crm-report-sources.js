"use strict";
const {queryShopify}=require('./crm-shopify');
const {dayAdd,periods,queryBatch,tableRows,buildRows}=require('./crm-period-report');
async function newProfiles(start,end){
 const all=[];let cursor=null;
 // Overfetch UTC boundary days, then bucket createdAt in the store timezone.
 const filter='customer_date:>='+dayAdd(start,-1)+' customer_date:<'+dayAdd(end,2);
 for(let page=0;page<100;page++){
  const d=await queryShopify('query CRMNewProfiles($cursor:String,$filter:String!){customers(first:50,after:$cursor,query:$filter,sortKey:CREATED_AT){pageInfo{hasNextPage endCursor} nodes{id createdAt defaultEmailAddress{marketingState}}}}',{cursor,filter});
  const conn=d.customers;if(!Array.isArray(conn?.nodes))throw Error('customers_unavailable');all.push(...conn.nodes);
  if(!conn.pageInfo.hasNextPage)return [...new Map(all.map(c=>[c.id,c])).values()];
  cursor=conn.pageInfo.endCursor;if(!cursor)throw Error('customers_incomplete');
 }
 throw Error('customers_page_limit');
}
async function metaSpend(start,end,timezone,currency){
 const token=process.env.META_SYSTEM_USER_TOKEN;
 let raw=process.env.META_AD_ACCOUNT_IDS||'';
 try{const parsed=JSON.parse(raw);if(Array.isArray(parsed))raw=parsed.join(',');}catch(_){}
 const ids=raw.split(/[\s,;]+/).filter(Boolean).map(s=>s.replace(/^act_/,''));
 if(!token||!ids.length)throw Error('meta_not_configured');
 if(ids.some(x=>!/^\d+$/.test(x)))throw Error('meta_account_configuration_invalid');
 const campaigns=(process.env.META_ACQUISITION_CAMPAIGN_IDS||'').split(/[\s,;]+/).filter(Boolean);
 if(!campaigns.length)throw Error('meta_acquisition_scope_not_configured');
 if(campaigns.some(x=>!/^\d+$/.test(x)))throw Error('meta_campaign_configuration_invalid');
 const version=process.env.META_GRAPH_API_VERSION||'v27.0';
 if(!/^v\d+\.\d+$/.test(version))throw Error('meta_api_version_invalid');
 const totals={};for(let d=start;d<=end;d=dayAdd(d,1))totals[d]=0;
 async function call(path,params){
  const u=new URL('https://graph.facebook.com/'+version+'/'+path);for(const [k,v] of Object.entries(params))u.searchParams.set(k,v);
  const r=await fetch(u,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(20000)});const j=await r.json();
  if(!r.ok||j.error)throw Error('meta_api_unavailable');return j;
 }
 for(const id of ids){
  const account=await call('act_'+id,{fields:'currency,timezone_name'});
  if(account.currency!==currency)throw Error('meta_currency_mismatch');
  if(account.timezone_name!==timezone)throw Error('meta_timezone_mismatch');
  let after=null;
  for(let page=0;page<20;page++){
   const j=await call('act_'+id+'/insights',{fields:'spend,date_start',filtering:JSON.stringify([{field:'campaign.id',operator:'IN',value:campaigns}]),time_increment:'1',time_range:JSON.stringify({since:start,until:end}),limit:'100',...(after?{after}:{})});
   if(!Array.isArray(j.data))throw Error('meta_invalid_response');
   for(const x of j.data){const spend=Number(x.spend);if(!Number.isFinite(spend)||!(x.date_start in totals))throw Error('meta_invalid_response');totals[x.date_start]+=spend;}
   if(!j.paging?.next)break;
   after=j.paging?.cursors?.after;if(!after||page===19)throw Error('meta_incomplete');
  }
 }
 return totals;
}
async function refresh(manual={}){
 const meta=await queryShopify('query CRMReportShop{shop{ianaTimezone currencyCode}}');
 const timezone=meta.shop.ianaTimezone,currency=meta.shop.currencyCode;
 const p=periods(new Date(),timezone),errors={};
 const run=async(name,fn)=>{try{return await fn()}catch(_){errors[name]='unavailable';return null;}};
 const [day,week,customers,ads]=await Promise.all([
  run('dailyAnalytics',()=>queryShopify(queryBatch('day',p.daily[0].start,p.end))),
  run('weeklyAnalytics',()=>queryShopify(queryBatch('week',p.start,p.end))),
  run('newProfiles',()=>newProfiles(p.start,p.end)),
  (async()=>{try{return await metaSpend(p.start,p.end,timezone,currency);}catch(e){errors.meta=e.message;return null;}})()
 ]);
 const parse=(data,k,name)=>{try{return tableRows(data?.[k])}catch(_){errors[name]='unavailable';return null;}};
 const common={customers,metaDaily:ads,manual,timezone,currency,sourceErrors:errors};
 const daily=buildRows(p.daily,{...common,sales:parse(day,'sales','dailySales'),traffic:parse(day,'traffic','dailyVisitors')});
 const weekly=buildRows(p.weekly,{...common,sales:parse(week,'sales','weeklySales'),traffic:parse(week,'traffic','weeklyVisitors')});
 if(!day&&!week&&!customers)throw Error('report_sources_unavailable');
 return {version:1,generatedAt:new Date().toISOString(),timezone,currency,through:p.end,daily,weekly,sourceErrors:errors,
  definitions:{emailAdded:'周期内创建的客户档案数，不限订阅；按createdAt',subscriptionRate:'新增且当前SUBSCRIBED人数 / 在线商城去重访客 ×100%',buyers:'Shopify周期内独立去重customers；不相加新客和回头客',newBuyers:'周期内首次成交客户',newConversion:'新成交客户 / 在线商城去重访客 ×100%',returningBuyers:'周期内再次购买的去重客户',retention:'回头客 / 新成交客户 ×100%，自定义可超过100%',ltv:'(Total Sales / 订单数) × (订单数 / 购买总人数) ×0.25',cac:'可用Meta及Google获客广告花费 / 新成交客户；标注来源范围',ltvCac:'LTV / CAC'},
  notes:['日报截至店铺昨日；周报周一至周日，本周未完结时标注截至昨日。','周购买人数和访客数由整周独立去重；不加总日报，也不平均比率。','新增客户档案的订阅状态为本次更新时的当前状态，历史比率可随退订变化。','零分母和数据缺失不输出0；LTV和留存率为用户自定义口径。','Meta API只统计已配置的获客活动；未指定活动范围、币种或时区不一致时留空。可录入同周期同币种Meta及Google获客花费。']};
}
module.exports={refresh,newProfiles,metaSpend};
