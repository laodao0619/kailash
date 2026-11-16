"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const {calculate,periods,buildRows,queryBatch,tableRows}=require('../lib/crm-period-report');
const base={totalSales:1000,orders:4,buyers:3,newBuyers:1,returningBuyers:3,newSubscribed:2,visitors:100,emailAdded:5,metaSpend:50,googleSpend:null};
test('all ten metric definitions preserve overlapping new and returning buyers and custom retention',()=>{
 const r=calculate(base);assert.equal(r.buyers,3);assert.equal(r.retention,300);
 assert.equal(r.subscriptionRate,2);assert.equal(r.newConversion,1);assert.equal(r.aov,250);
 assert.equal(r.ltv,1000/3*0.25);assert.equal(r.cac,50);assert.equal(r.ltvCac,r.ltv/50);assert.equal(r.emailAdded,5);
 assert.equal(calculate({...base,googleSpend:25}).cac,75);
});
test('zero denominators, unknown advertising and true zero spend remain distinct',()=>{
 const r=calculate({...base,buyers:0,newBuyers:0,visitors:0});
 for(const k of ['ltv','cac','ltvCac','retention','subscriptionRate','newConversion'])assert.equal(r[k],null,k);
 assert.equal(calculate({...base,metaSpend:null}).cac,null);
 assert.equal(calculate({...base,metaSpend:0}).cac,0);
 assert.equal(calculate({...base,metaSpend:0}).ltvCac,null);
});
test('store midnight and daylight saving yield complete day rows and Monday weekly ranges',()=>{
 const p=periods(new Date('2026-11-16T03:00:00Z'),'America/New_York');
 assert.equal(p.today,'2026-11-15');assert.equal(p.end,'2026-11-14');assert.equal(p.daily.length,30);assert.equal(p.weekly.length,8);
 assert.equal(p.weekly.at(-1).start,'2026-11-09');assert.equal(p.weekly.at(-1).complete,false);
 assert.equal(periods(new Date('2026-11-16T06:00:00Z')).weekly.at(-1).complete,true);
});
test('week queries independently deduplicate customers and visitors, never sum daily counts',()=>{
 const q=queryBatch('week','2026-11-09','2026-11-15');assert(q.includes('TIMESERIES week'));assert(q.includes('customers, new_customers, returning_customers'));
 const rows=buildRows([{kind:'week',start:'2026-11-09',end:'2026-11-15'}],{
  sales:[{week:'2026-11-09',total_sales:13099.97,orders:57,customers:53,new_customers:33,returning_customers:23}],
  traffic:[{week:'2026-11-09',online_store_visitors:37903}],customers:[
   {createdAt:'2026-11-09T02:00:00Z',defaultEmailAddress:{marketingState:'SUBSCRIBED'}},
   {createdAt:'2026-11-10T02:00:00Z',defaultEmailAddress:{marketingState:'UNSUBSCRIBED'}},
   {createdAt:'2026-11-11T02:00:00Z',defaultEmailAddress:{marketingState:'SUBSCRIBED'}}],
  timezone:'America/New_York',currency:'USD',metaDaily:null,manual:{'2026-11-09_2026-11-15':{metaSpend:100,googleSpend:50}}});
 const r=rows[0];assert.equal(r.buyers,53);assert.equal(r.emailAdded,2);assert.equal(r.newSubscribed,1);assert.equal(r.visitors,37903);assert.equal(r.adSpend,150);
});
test('query failures leave metrics unknown instead of fabricated zeros; arrays normalize from columns',()=>{
 const r=buildRows([{kind:'day',start:'2026-11-09',end:'2026-11-09'}],{sales:null,traffic:null,customers:null,metaDaily:null,timezone:'America/New_York',currency:'USD'})[0];
 assert.equal(r.buyers,null);assert.equal(r.emailAdded,null);assert.equal(r.ltv,null);assert.equal(r.cac,null);
 assert.deepEqual(tableRows({tableData:{columns:[{name:'customers'}],rows:[['53']]}}),[{customers:'53'}]);
 assert.throws(()=>tableRows({parseErrors:['invalid'],tableData:{rows:[]}}));
});
