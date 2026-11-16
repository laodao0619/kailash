"use strict";
const {queryShopify}=require('./crm-shopify');
const {dayAdd,periods,queryBatch,tableRows,buildRows}=require('./crm-period-report');
const {POLICY}=require('./crm-email-attribution');
async function newProfiles(start,end){
 const all=[];let cursor=null;
 const filter='customer_date:>='+dayAdd(start,-1)+' customer_date:<'+dayAdd(end,2);
 for(let page=0;page<100;page++){
  const d=await queryShopify('query CRMNewProfiles($cursor:String,$filter:String!){customers(first:50,after:$cursor,query:$filter,sortKey:CREATED_AT){pageInfo{hasNextPage endCursor} nodes{id createdAt defaultEmailAddress{marketingState marketingUpdatedAt}}}}',{cursor,filter});
  const conn=d.customers;if(!Array.isArray(conn?.nodes))throw Error('customers_unavailable');all.push(...conn.nodes);
  if(!conn.pageInfo.hasNextPage)return [...new Map(all.map(c=>[c.id,c])).values()];
  cursor=conn.pageInfo.endCursor;if(!cursor)throw Error('customers_incomplete');
 }
 throw Error('customers_page_limit');
}
const VISITS='pageInfo{hasNextPage endCursor} nodes{... on CustomerVisit{id occurredAt source sourceType utmParameters{source medium campaign}}}';
const ORDER_QUERY='query CRMEmailOrders($cursor:String,$filter:String!){orders(first:20,after:$cursor,query:$filter,sortKey:PROCESSED_AT){pageInfo{hasNextPage endCursor} nodes{id processedAt test cancelledAt displayFinancialStatus currentTotalPriceSet{shopMoney{amount currencyCode}} customer{id} customerJourneySummary{ready customerOrderIndex moments(first:20){'+VISITS+'}}}}}';
async function orderJourneys(start,end){
 const rows=[];let cursor=null;
 const filter='processed_at:>='+dayAdd(start,-1)+' processed_at:<'+dayAdd(end,2)+' test:false';
 const deadline=Date.now()+85000;
 for(let page=0;page<150;page++){
  if(Date.now()>deadline)return {orders:rows,complete:false};
  const d=await queryShopify(ORDER_QUERY,{cursor,filter});
  const conn=d.orders;if(!Array.isArray(conn?.nodes))throw Error('orders_unavailable');
  for(let offset=0;offset<conn.nodes.length;offset+=3){
   await Promise.all(conn.nodes.slice(offset,offset+3).map(async o=>{
    const j=o.customerJourneySummary;if(!j?.ready||!j.moments)return;
    for(let n=0;j.moments.pageInfo.hasNextPage&&n<10&&Date.now()<deadline;n++){
     const after=j.moments.pageInfo.endCursor;if(!after)break;
     try{
      const data=await queryShopify('query CRMEmailOrderMoments($id:ID!,$cursor:String){node(id:$id){... on Order{customerJourneySummary{moments(first:50,after:$cursor){'+VISITS+'}}}}}',{id:o.id,cursor:after});
      const next=data.node?.customerJourneySummary?.moments;if(!next)break;
      j.moments.nodes.push(...next.nodes);j.moments.pageInfo=next.pageInfo;
     }catch(_){break;}
    }
   }));
  }
  rows.push(...conn.nodes);
  if(!conn.pageInfo.hasNextPage)return {orders:rows,complete:true};
  cursor=conn.pageInfo.endCursor;if(!cursor)throw Error('orders_incomplete');
 }
 return {orders:rows,complete:false};
}
async function currentPopulation(){
 const {snapshot}=require('../api/bi-customers-v2');const d=await snapshot();
 const valid=d.customers.filter(c=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email||'')&&!/无效|机器人|测试|重复|invalid|robot|bot/i.test(c.quality||''));
 const subscribed=valid.filter(c=>['SUBSCRIBED','已订阅','订阅','同意营销'].includes(c.subscription));
 return {validEmailPopulation:valid.length,subscribedPopulation:subscribed.length,subscriptionRate:valid.length?subscribed.length/valid.length*100:null,asOf:d.generatedAt,scope:'当前Shopify同步CRM快照；其他平台待接入，非历史期末值'};
}
async function refresh(){
 const meta=await queryShopify('query CRMReportShop{shop{ianaTimezone currencyCode}}');
 const timezone=meta.shop.ianaTimezone,currency=meta.shop.currencyCode;
 const p=periods(new Date(),timezone),errors={subscriptionHistory:'consent_event_history_not_connected',externalPlatforms:'external_customer_and_click_feeds_not_connected'};
 const run=async(name,fn)=>{try{return await fn()}catch(_){errors[name]='unavailable';return null;}};
 const [day,week,customers,journeys,population]=await Promise.all([
  run('dailyAnalytics',()=>queryShopify(queryBatch('day',p.daily[0].start,p.end))),
  run('weeklyAnalytics',()=>queryShopify(queryBatch('week',p.start,p.end))),
  run('newProfiles',()=>newProfiles(p.start,p.end)),run('emailJourneys',()=>orderJourneys(p.start,p.end)),run('population',currentPopulation)
 ]);
 const parse=(data,k,name)=>{try{return tableRows(data?.[k])}catch(_){errors[name]='unavailable';return null;}};
 if(journeys&&!journeys.complete)errors.orderHistory='incomplete_scan';
 const common={customers,orders:journeys?.orders??null,ordersComplete:journeys?.complete??false,timezone,currency,sourceErrors:errors};
 const build=(periodList,data)=>buildRows(periodList,{...common,sales:parse(data,'sales','sales'),traffic:parse(data,'traffic','traffic'),emailTraffic:parse(data,'emailTraffic','emailTraffic')});
 const daily=build(p.daily,day),weekly=build(p.weekly,week);
 if(!day&&!week&&!customers)throw Error('report_sources_unavailable');
 return {version:2,generatedAt:new Date().toISOString(),timezone,currency,through:p.end,daily,weekly,currentPopulation:population,attribution:POLICY,sourceErrors:errors,
  definitions:{emailAdded:'周期内新建客户档案，跨平台统一身份去重；当前已接入Shopify',newSubscribers:'周期内新增订阅去重客户，包含新档案、老档案首次订阅和重新订阅；缺完整事件日志时留空',subscriptionRate:'期末当前已订阅有效邮箱客户 / 期末有效邮箱客户池 ×100%；历史快照缺失留空，当前覆盖率另列',buyers:'本期邮件点击7天内、最后一次非直接访问归因的去重成交客户',newBuyers:'邮件归因订单的customerOrderIndex=1，首次全店购买',newConversion:'邮件首购客户 / 本期邮件渠道去重访客 ×100%；归因不完整时留空',returningBuyers:'邮件归因订单的customerOrderIndex>1，成交前已有购买',retention:'邮件回头客 / 邮件新客 ×100%，自定义非cohort；归因不完整时留空',emailSales:'邮件7天点击归因订单currentTotalPriceSet.shopMoney，已反映当前订单调整；同订单只计一次'},
  notes:['归因：成交前7×24小时内，最后一次可识别非直接访问为邮件；直接回访不覆盖邮件，之后其他渠道点击会覆盖。按成交日计入报表。','邮件访问由Shopify已记录CustomerVisit的email来源/UTM识别；跨设备或未记录点击无法补造。其他邮件平台带有可识别UTM的访问可纳入，独立平台客户和点击日志尚未接入。','邮件销售额按订单当前Total Price及店铺币种，排除测试、取消及全额退款订单；后续退款会回刷过去周期。首购/复购按订单当时的全店购买序号判断。','主表只展示CRM/EDM；全店数据独立参考。新客与回头客可能重叠，购买总人数独立去重。周报重新去重，不加总日报人数。','邮件累计新增目前仅含Shopify已接入档案，不重复把同步视为新增。其他平台待接入。','邮件新增订阅人数和历史期末订阅率缺少完整订阅事件/快照时留空；当前客户池覆盖率单独展示，不能用当前订阅状态回填历史新增。','归因未准备就绪/分页未完成时，成交人数和销售额标为已核验部分，下限不是全量；相关转化率/留存率留空。','每日北京时间13:30刷新；日报截至店铺昨日，周报周一至周日。新报表已取消LTV和CAC及广告花费。']};
}
module.exports={refresh,newProfiles,orderJourneys,currentPopulation,ORDER_QUERY};
