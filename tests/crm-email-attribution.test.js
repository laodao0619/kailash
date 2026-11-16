"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const {attribute,summarizeOrders,WINDOW_MS}=require('../lib/crm-email-attribution');
const at='2026-11-15T12:00:00Z';
const click=(iso,source='email')=>({id:iso+source,occurredAt:iso,source,utmParameters:source==='email'?{source:'shopify_email',medium:'email',campaign:'Giving'}:null});
function order(visits,patch={}){return {id:'o1',processedAt:at,test:false,cancelledAt:null,displayFinancialStatus:'PAID',customer:{id:'c1'},currentTotalPriceSet:{shopMoney:{amount:'100',currencyCode:'USD'}},customerJourneySummary:{ready:true,customerOrderIndex:1,moments:{pageInfo:{hasNextPage:false},nodes:visits}},...patch};}
test('exact 7x24h boundary qualifies; older and future clicks never qualify',()=>{
 assert.equal(WINDOW_MS,604800000);
 assert.equal(attribute(order([click('2026-11-08T12:00:00Z')])).status,'email');
 assert.equal(attribute(order([click('2026-11-08T11:59:59Z')])).status,'not_email');
 assert.equal(attribute(order([click('2026-11-15T12:00:01Z')])).status,'not_email');
});
test('last non-direct click wins and direct return does not erase email',()=>{
 assert.equal(attribute(order([click('2026-11-14T12:00:00Z'),click('2026-11-15T10:00:00Z','direct')])).status,'email');
 assert.equal(attribute(order([click('2026-11-14T12:00:00Z'),click('2026-11-15T10:00:00Z','facebook')])).status,'not_email');
});
test('unready and truncated journeys fail closed; duplicate/tied channels cannot fabricate attribution',()=>{
 const o=order([click('2026-11-14T12:00:00Z')]);o.customerJourneySummary.moments.pageInfo.hasNextPage=true;
 assert.equal(attribute(o).status,'unverified');
 assert.equal(attribute(order([click('2026-11-14T12:00:00Z'),click('2026-11-14T12:00:00Z','facebook')])).status,'unverified');
});
test('email platforms, order-time new/returning types and unique buyer union are preserved',()=>{
 const a=order([click('2026-11-14T12:00:00Z')]);
 const b=order([click('2026-11-14T12:00:00Z')],{id:'o2'});b.customerJourneySummary.customerOrderIndex=2;
 const r=summarizeOrders([a,a,b],'2026-11-09','2026-11-15','America/New_York','USD');
 assert.equal(r.buyers,1);assert.equal(r.newBuyers,1);assert.equal(r.returningBuyers,1);assert.equal(r.emailSales,200);assert.equal(r.emailNewSales,100);assert.equal(r.emailReturningSales,100);assert.equal(r.emailOrders,2);
});
test('cancelled, test, refunded and pending orders excluded; currency and missing identities flagged',()=>{
 const visits=[click('2026-11-14T12:00:00Z')];
 for(const patch of [{test:true},{cancelledAt:at},{displayFinancialStatus:'REFUNDED'},{displayFinancialStatus:'PENDING'}])assert.equal(attribute(order(visits,patch)).status,'excluded');
 const o=order(visits);o.currentTotalPriceSet.shopMoney.currencyCode='EUR';
 const r=summarizeOrders([o],'2026-11-09','2026-11-15','America/New_York','USD');assert.equal(r.emailSales,0);assert.equal(r.attributionCoverage.complete,false);
});
