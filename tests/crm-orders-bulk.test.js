"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {BULK_QUERY,start,poll,downloadUrl}=require("../lib/crm-orders-bulk");

test("bulk export includes all orders, customer IDs and product facts without a date filter",()=>{
 assert.match(BULK_QUERY,/orders\(sortKey: PROCESSED_AT\)/);
 assert.doesNotMatch(BULK_QUERY,/query:|processed_at:>=|first:\s*50/);
 for(const field of ["customer { id }","totalRefundedSet","currentSubtotalPriceSet","transactions { id kind status amountSet","lineItems","vendor tags description","cancelledAt","test"])
  assert.ok(BULK_QUERY.includes(field),field);
});
test("Bulk JSONL retains shop currency and original presentment currency for reconciliation",()=>{
 // All seven Shopify MoneyBag selections must retain both shop and presentment amounts.
 // Match real GraphQL braces, not literal backslash characters.
 const paired=/shopMoney\s*\{\s*amount\s+currencyCode\s*\}\s+presentmentMoney\s*\{\s*amount\s+currencyCode\s*\}/g;
 assert.equal((BULK_QUERY.match(paired)||[]).length,7,"Every MoneyBag must retain both currency perspectives");
 assert.equal((BULK_QUERY.match(/\bshopMoney\b/g)||[]).length,7,"No unpaired shopMoney allowed");
 assert.equal((BULK_QUERY.match(/\bpresentmentMoney\b/g)||[]).length,7,"No unpaired presentmentMoney allowed");
 assert.match(BULK_QUERY,/\bcurrencyCode\s+subtotalPriceSet\b/);
 assert.match(BULK_QUERY,/transactions\s*\{\s*id\s+kind\s+status\s+amountSet\b/);
 // The financial audit uses shop USD, not presentment numbers as a fake FX conversion.
 const {money}=require("../lib/crm-orders-ledger");
 assert.equal(money({
  shopMoney:{amount:"15.00",currencyCode:"USD"},
  presentmentMoney:{amount:"2300",currencyCode:"JPY"},
 }),1500);
 assert.equal(money({
  shopMoney:{amount:"15.00",currencyCode:"EUR"},
  presentmentMoney:{amount:"15.00",currencyCode:"USD"},
 }),null);
});
test("bulk start rejects API user errors",async()=>{
 await assert.rejects(()=>start(async()=>({bulkOperationRunQuery:{userErrors:[{message:"scope missing"}],bulkOperation:null}})),/scope missing/);
});
test("bulk start sends a Shopify bulk operation and returns ID",async()=>{
 let variables;
 const op=await start(async(query,args)=>{variables=args;assert.match(query,/bulkOperationRunQuery/);return {bulkOperationRunQuery:{bulkOperation:{id:"gid://shopify/BulkOperation/123",status:"CREATED"},userErrors:[]}};});
 assert.equal(op.status,"CREATED");assert.equal(variables.query,BULK_QUERY);
});
test("bulk polling verifies operation identity",async()=>{
 const id="gid://shopify/BulkOperation/123";
 await assert.rejects(()=>poll(async()=>({node:{id:"wrong"}}),id),/not found/);
 assert.equal((await poll(async()=>({node:{id,status:"COMPLETED"}}),id)).status,"COMPLETED");
});
test("bulk export URL must use Shopify storage HTTPS endpoint",()=>{
 assert.equal(downloadUrl("https://storage.googleapis.com/shopify/bulk.jsonl?signature=abc").hostname,"storage.googleapis.com");
 for(const url of ["http://storage.googleapis.com/test","https://evil.example/test","https://user:pass@storage.googleapis.com/test","https://storage.googleapis.com:444/test"])
  assert.throws(()=>downloadUrl(url));
});


test("full-history Shopify export requires a production stage AND exact explicit merchant opt-in",()=>{
 const {isExplicitBulkExportEnabled}=require("../lib/crm-orders-bulk");
 for(const value of [undefined,null,"","0","1","yes","TRUE","false",true])
  assert.equal(isExplicitBulkExportEnabled({VERCEL_ENV:"production",CRM_FINANCE_BULK_ENABLED:value}),false,String(value));
 for(const stage of [undefined,null,"","preview","development","staging","PRODUCTION"])
  assert.equal(isExplicitBulkExportEnabled({VERCEL_ENV:stage,CRM_FINANCE_BULK_ENABLED:"true"}),false,String(stage));
 assert.equal(isExplicitBulkExportEnabled({VERCEL_ENV:"production",CRM_FINANCE_BULK_ENABLED:"true"}),true);
});

test("finance-only extraction preserves active production cron policy without adding a bulk job",()=>{
 const {crons}=require("../vercel.json");
 assert.deepEqual(crons.filter(x=>x.path==="/api/crm-orders-bulk"),[],
  "full-history export must not be scheduled before merchant UAT");
 for(const path of ["/api/crm-daily-customers","/api/crm-daily-orders","/api/crm-daily-gmail"])
  assert.equal(crons.filter(x=>x.path===path).length,3,path);
 // Main still contains this legacy job; retirement is a separate reviewed task
 // after an authenticated finished=true checkpoint, not part of finance work.
 assert.deepEqual(crons.filter(x=>x.path==="/api/crm-gmail-filtered"),
  [{path:"/api/crm-gmail-filtered",schedule:"*/10 * * * *"}]);
});
