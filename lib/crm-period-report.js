"use strict";
const METRICS=[['emailAdded','邮件累计新增'],['newSubscribers','邮件新增订阅人数'],['subscriptionRate','客户订阅率'],['buyers','邮件渠道购买总人数'],['newBuyers','邮件渠道新客户数'],['newConversion','邮件渠道新客户转化率'],['returningBuyers','邮件渠道回头客数'],['retention','邮件客户留存率〔自定义〕'],['emailSales','邮件渠道销售额']];
const dayAdd=(s,n)=>new Date(Date.parse(s+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
const localDay=(d,tz)=>new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(d));
function monday(d){const w=new Date(d+'T12:00:00Z').getUTCDay();return dayAdd(d,-((w+6)%7));}
function periods(now=new Date(),timezone='America/New_York'){
 const today=localDay(now,timezone),end=dayAdd(today,-1),daily=[];
 for(let i=29;i>=0;i--){const start=dayAdd(end,-i);daily.push({kind:'day',start,end:start,complete:true});}
 const weekly=[],last=monday(end);
 for(let i=7;i>=0;i--){const start=dayAdd(last,-i*7),finish=dayAdd(start,6);weekly.push({kind:'week',start,end:finish>end?end:finish,complete:finish<=end});}
 return {today,end,daily,weekly,start:weekly[0].start};
}
function ratio(a,b,multiplier=1){return Number.isFinite(a)&&Number.isFinite(b)&&b>0?a/b*multiplier:null;}
function calculate(x){
 return {...x,subscriptionRate:ratio(x.subscribedPopulation,x.validEmailPopulation,100),
  newConversion:x.attributionCoverage?.complete===false?null:ratio(x.newBuyers,x.emailVisitors,100),
  retention:x.attributionCoverage?.complete===false?null:ratio(x.returningBuyers,x.newBuyers,100),
  emailSalesShare:ratio(x.emailSales,x.storeSales,100)};
}
function tableRows(q){
 if(!q||q.parseErrors?.length||!Array.isArray(q.tableData?.rows))throw Error('analytics_query_unavailable');
 const cols=q.tableData.columns||[];
 return q.tableData.rows.map(r=>Array.isArray(r)?Object.fromEntries(cols.map((c,i)=>[c.name,r[i]])):r);
}
function value(row,key){if(row?.[key]===null||row?.[key]===undefined||row?.[key]==='')return null;const n=Number(row[key]);return Number.isFinite(n)?n:null;}
function buildRows(periodList,{sales,traffic,emailTraffic,customers,orders,ordersComplete=true,populationHistory={},timezone,currency,sourceErrors={}}){
 const {summarizeOrders}=require('./crm-email-attribution');
 return periodList.map(p=>{
  const key=p.kind==='week'?'week':'day',find=rows=>rows?.find(r=>String(r[key]).slice(0,10)===p.start);
  const s=find(sales),t=find(traffic),e=find(emailTraffic);
  const created=customers?.filter(c=>{const d=localDay(c.createdAt,timezone);return d>=p.start&&d<=p.end;});
  const num=(row,field,rows)=>rows==null?null:row?value(row,field):0;
  const email=orders?summarizeOrders(orders,p.start,p.end,timezone,currency,ordersComplete):{buyers:null,newBuyers:null,returningBuyers:null,emailSales:null,emailNewSales:null,emailReturningSales:null,emailOrders:null,breakdown:[],attributionCoverage:{complete:false,unverified:null}};
  const population=populationHistory[p.end]||{};
  return calculate({...p,currency,...email,
   emailAdded:created?created.length:null,newSubscribers:null,
   subscribedPopulation:population.subscribedPopulation??null,validEmailPopulation:population.validEmailPopulation??null,
   emailVisitors:num(e,'online_store_visitors',emailTraffic),
   storeSales:num(s,'total_sales',sales),storeBuyers:num(s,'customers',sales),storeNewBuyers:num(s,'new_customers',sales),storeReturningBuyers:num(s,'returning_customers',sales),storeVisitors:num(t,'online_store_visitors',traffic),
   sourceErrors,subscriptionCoverage:'缺少完整历史订阅事件及期末客户池快照，历史订阅人数/订阅率不回填估算值'});
 });
}
function queryBatch(kind,start,end){
 if(!['day','week'].includes(kind)||![start,end].every(d=>/^\d{4}-\d{2}-\d{2}$/.test(d))||start>end)throw Error('invalid_period');
 const range=' TIMESERIES '+kind+' SINCE '+start+' UNTIL '+end;
 const queries={sales:'FROM sales SHOW total_sales, orders, customers, new_customers, returning_customers'+range,
  traffic:'FROM sessions SHOW online_store_visitors'+range,
  emailTraffic:"FROM sessions SHOW online_store_visitors WHERE utm_medium = 'email' OR referrer_source = 'email'"+range};
 return 'query CRMPeriodAnalytics{'+Object.entries(queries).map(([k,q])=>k+':shopifyqlQuery(query:'+JSON.stringify(q)+'){parseErrors tableData{columns{name} rows}}').join(' ')+'}';
}
function csv(report,kind){
 const esc=v=>'"'+String(v??'').replace(/"/g,'""')+'"';
 const cols=[['start','周期开始'],['end','周期结束'],...METRICS,['emailNewSales','邮件首购销售额'],['emailReturningSales','邮件复购销售额'],['emailVisitors','邮件渠道去重访客'],['storeSales','参考_全店销售额'],['storeBuyers','参考_全店购买人数'],['storeNewBuyers','参考_全店新客户数'],['storeReturningBuyers','参考_全店回头客数'],['emailSalesShare','参考_邮件销售占比%'],['coverageLabel','归因覆盖'],['currency','币种']];
 return '\ufeff'+cols.map(x=>esc(x[1])).join(',')+'\r\n'+(report[kind]||[]).map(row=>{const r={...row,coverageLabel:row.attributionCoverage?.complete?'已记录访问内完整':'仅已核验部分'};return cols.map(([k])=>esc(r[k]===null||r[k]===undefined?'待接入/无有效分母':typeof r[k]==='number'?Math.round(r[k]*10000)/10000:r[k])).join(',')}).join('\r\n');
}
module.exports={METRICS,dayAdd,localDay,monday,periods,ratio,calculate,tableRows,buildRows,queryBatch,csv};
