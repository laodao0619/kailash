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
