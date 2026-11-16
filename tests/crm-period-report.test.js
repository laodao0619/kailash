"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const {calculate,periods,buildRows,queryBatch,tableRows,csv,METRICS}=require('../lib/crm-period-report');
test('twelve metrics include ordered current totals and sales share with distinct UV denominators',()=>{
 assert.equal(METRICS.length,12);assert(!METRICS.some(([k])=>/ltv|cac/i.test(k)));
 assert.deepEqual(METRICS.slice(0,4).map(([k])=>k),['emailTotal','emailAdded','totalSubscribers','newSubscribers']);
 assert.equal(METRICS.at(-1)[0],'emailSalesShare');
 const r=calculate({totalSubscribers:20,emailTotal:100,newBuyers:1,returningBuyers:3,emailVisitors:10,storeVisitors:1000,emailSales:50,storeSales:500});
 assert.equal(r.subscriptionRate,2);assert.equal(r.newConversion,10);assert.equal(r.retention,300);assert.equal(r.emailSalesShare,10);
});
test('zero denominators and partial attribution never become fake zero rates',()=>{
 const r=calculate({newBuyers:0,returningBuyers:3,emailVisitors:0,subscribedPopulation:0,validEmailPopulation:0});
 for(const k of ['subscriptionRate','newConversion','retention'])assert.equal(r[k],null);
 assert.equal(calculate({newBuyers:1,returningBuyers:3,emailVisitors:10,attributionCoverage:{complete:false}}).newConversion,null);
});
test('store midnight and daylight saving preserve complete day and Monday week periods',()=>{
 const p=periods(new Date('2026-11-16T03:00:00Z'),'America/New_York');
 assert.equal(p.today,'2026-11-15');assert.equal(p.end,'2026-11-14');assert.equal(p.daily.length,30);assert.equal(p.weekly.length,8);
 assert.equal(p.weekly.at(-1).start,'2026-11-09');assert.equal(p.weekly.at(-1).complete,false);
});
test('weekly metrics query independent email visitor deduplication; profile counts use creation not subscription',()=>{
 const q=queryBatch('week','2026-11-09','2026-11-15');assert(q.includes('TIMESERIES week'));assert(q.includes("utm_medium = 'email'"));
 const [r]=buildRows([{kind:'week',start:'2026-11-09',end:'2026-11-15'}],{
  sales:[{week:'2026-11-09',total_sales:1000,customers:50,new_customers:30,returning_customers:23}],traffic:[],emailTraffic:[{week:'2026-11-09',online_store_visitors:155}],orders:[],
  customers:[{createdAt:'2026-11-09T02:00:00Z'},{createdAt:'2026-11-10T02:00:00Z'}],timezone:'America/New_York',currency:'USD'});
 assert.equal(r.emailAdded,1);assert.equal(r.storeBuyers,50);assert.equal(r.buyers,0);assert.equal(r.emailVisitors,155);
 assert.equal(r.newSubscribers,null);assert.equal(r.subscriptionRate,null);
});
test('missing source fields stay null and CSV separates whole-store references from EDM columns',()=>{
 const r=buildRows([{kind:'day',start:'2026-11-09',end:'2026-11-09'}],{sales:null,traffic:null,emailTraffic:null,customers:null,orders:null,timezone:'America/New_York',currency:'USD'})[0];
 assert.equal(r.buyers,null);assert.equal(r.emailSales,null);assert.equal(r.newSubscribers,null);
 const content=csv({daily:[r]},'daily');assert(!content.includes('CAC'));assert(!content.includes('LTV'));assert(content.includes('参考_全店销售额'));
 assert.deepEqual(tableRows({tableData:{columns:[{name:'customers'}],rows:[['53']]}}),[{customers:'53'}]);
});

test('current subscriber stock divides by each period UV and is never summed across days',()=>{
 const rows=buildRows([{kind:'day',start:'2026-11-09',end:'2026-11-09'},{kind:'week',start:'2026-11-09',end:'2026-11-15'}],{
  sales:[],traffic:[{day:'2026-11-09',online_store_visitors:10},{week:'2026-11-09',online_store_visitors:100}],emailTraffic:[],customers:[],orders:[],
  currentPopulation:{validEmailPopulation:1000,subscribedPopulation:200,asOf:'2026-11-16T00:00:00Z'},timezone:'America/New_York',currency:'USD'});
 assert.equal(rows[0].subscriptionRate,2000);assert.equal(rows[1].subscriptionRate,200);
 assert.equal(rows[0].emailTotal,1000);assert.equal(rows[1].totalSubscribers,200);assert.equal(rows[0].newSubscribers,null);
 assert.equal(rows[0].populationAsOf,'2026-11-16T00:00:00Z');
 const header=csv({daily:rows},'daily').split('\r\n')[0];
 assert.equal((header.match(/邮件销售额占全店比例/g)||[]).length,1);assert(header.includes('周期全站去重UV'));
});
