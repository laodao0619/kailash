"use strict";
const METRICS=[['emailAdded','邮件累计新增'],['subscriptionRate','客户订阅率'],['buyers','购买总人数'],['newBuyers','新客户数'],['newConversion','新客户转化率'],['returningBuyers','回头客数'],['retention','客户留存率'],['ltv','LTV'],['cac','CAC'],['ltvCac','LTV/CAC']];
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
 const aov=ratio(x.totalSales,x.orders);
 const frequency=ratio(x.orders,x.buyers);
 const ltv=aov===null||frequency===null?null:frequency*aov*0.25;
 // Null means unavailable, not zero. An explicitly supplied zero is valid.
 const meta=Number.isFinite(x.metaSpend)?x.metaSpend:null,google=Number.isFinite(x.googleSpend)?x.googleSpend:null;
 const adSpend=meta===null&&google===null?null:(meta??0)+(google??0);
 const cac=ratio(adSpend,x.newBuyers);
 return {...x,emailAdded:x.emailAdded??null,buyers:x.buyers??null,newBuyers:x.newBuyers??null,returningBuyers:x.returningBuyers??null,
  aov,adSpend,adScope:meta!==null&&google!==null?'Meta + Google':meta!==null?'Meta':google!==null?'Google':'待接入',
  subscriptionRate:ratio(x.newSubscribed,x.visitors,100),newConversion:ratio(x.newBuyers,x.visitors,100),
  retention:ratio(x.returningBuyers,x.newBuyers,100),ltv,cac,ltvCac:ratio(ltv,cac)};
}
function tableRows(q){
 if(!q||q.parseErrors?.length||!Array.isArray(q.tableData?.rows))throw Error('analytics_query_unavailable');
 const cols=q.tableData.columns||[];
 return q.tableData.rows.map(r=>Array.isArray(r)?Object.fromEntries(cols.map((c,i)=>[c.name,r[i]])):r);
}
function value(row,key){if(row?.[key]===null||row?.[key]===undefined||row?.[key]==='')return null;const n=Number(row[key]);return Number.isFinite(n)?n:null;}
function buildRows(periodList,{sales,traffic,customers,metaDaily,manual={},timezone,currency,sourceErrors={}}){
 return periodList.map(p=>{
  const key=p.kind==='week'?'week':'day';
  const s=sales?.find(r=>String(r[key]).slice(0,10)===p.start);
  const t=traffic?.find(r=>String(r[key]).slice(0,10)===p.start);
  const created=customers?.filter(c=>{const d=localDay(c.createdAt,timezone);return d>=p.start&&d<=p.end;});
  const days=[];for(let d=p.start;d<=p.end;d=dayAdd(d,1))days.push(d);
  const exact=manual[p.start+'_'+p.end];
  const dailySpend=platform=>{
   const amounts=days.map(d=>manual[d+'_'+d]?.[platform]);
   return amounts.every(Number.isFinite)?amounts.reduce((a,b)=>a+b,0):null;
  };
  let metaSpend=exact?.metaSpend??dailySpend('metaSpend');
  if(metaSpend===null&&metaDaily&&days.every(d=>Number.isFinite(metaDaily[d])))metaSpend=days.reduce((a,d)=>a+metaDaily[d],0);
  const googleSpend=exact?.googleSpend??dailySpend('googleSpend');
  const num=(row,field,rows)=>rows===null?null:row?value(row,field):0;
  return calculate({...p,currency,
   emailAdded:created?created.length:null,newSubscribed:created?created.filter(c=>c.defaultEmailAddress?.marketingState==='SUBSCRIBED').length:null,
   totalSales:num(s,'total_sales',sales),orders:num(s,'orders',sales),buyers:num(s,'customers',sales),
   newBuyers:num(s,'new_customers',sales),returningBuyers:num(s,'returning_customers',sales),visitors:num(t,'online_store_visitors',traffic),
   metaSpend,googleSpend,sourceErrors,
   adsSource:exact?'手工录入（同周期同币种）':metaSpend!==null?'Meta API / 已录入日花费':'广告花费待接入'});
 });
}
function queryBatch(kind,start,end){
 if(!['day','week'].includes(kind)||![start,end].every(d=>/^\d{4}-\d{2}-\d{2}$/.test(d))||start>end)throw Error('invalid_period');
 const range=' TIMESERIES '+kind+' SINCE '+start+' UNTIL '+end;
 const queries={sales:'FROM sales SHOW total_sales, orders, customers, new_customers, returning_customers'+range,
  traffic:'FROM sessions SHOW online_store_visitors'+range};
 return 'query CRMPeriodAnalytics{'+Object.entries(queries).map(([k,q])=>k+':shopifyqlQuery(query:'+JSON.stringify(q)+'){parseErrors tableData{columns{name} rows}}').join(' ')+'}';
}
function csv(report,kind){
 const esc=v=>'"'+String(v??'').replace(/"/g,'""')+'"';
 const cols=[['start','周期开始'],['end','周期结束'],...METRICS,['visitors','在线商城去重访客'],['newSubscribed','新增且当前订阅人数'],['totalSales','Total Sales'],['orders','订单数'],['aov','店铺客单价'],['metaSpend','Meta花费'],['googleSpend','Google花费'],['adScope','CAC花费范围'],['currency','币种']];
 return '\ufeff'+cols.map(x=>esc(x[1])).join(',')+'\r\n'+(report[kind]||[]).map(r=>cols.map(([k])=>esc(r[k]===null||r[k]===undefined?'待接入/无有效分母':typeof r[k]==='number'?Math.round(r[k]*10000)/10000:r[k])).join(',')).join('\r\n');
}
module.exports={METRICS,dayAdd,localDay,monday,periods,ratio,calculate,tableRows,buildRows,queryBatch,csv};
