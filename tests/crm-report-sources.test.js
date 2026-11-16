"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const shopify=require('../lib/crm-shopify');
const original=shopify.queryShopify;
let calls=[];
shopify.queryShopify=async(query,variables)=>{
 calls.push({query,variables});
 assert(variables.filter.startsWith('customer_date:>='));
 assert(!variables.filter.includes('created_at:'));
 const node={id:'gid://shopify/Customer/1',createdAt:'2026-11-10T00:00:00Z',defaultEmailAddress:{marketingState:'SUBSCRIBED'}};
 return {customers:{nodes:[node],pageInfo:{hasNextPage:!variables.cursor,endCursor:'next'}}};
};
const {newProfiles}=require('../lib/crm-report-sources');
test.after(()=>{shopify.queryShopify=original});
test('customer creation uses Shopify customer_date search, completes pages and deduplicates identities',async()=>{
 const rows=await newProfiles('2026-11-09','2026-11-15');
 assert.equal(rows.length,1);assert.equal(calls.length,2);assert.equal(calls[1].variables.cursor,'next');
});
