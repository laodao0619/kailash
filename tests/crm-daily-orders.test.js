"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {mock}=require("node:test");
const handler=require("../api/crm-daily-orders");
const state=require("../lib/crm-daily-state");
const shopify=require("../lib/crm-shopify");
const previous=process.env.CRON_SECRET;
process.env.CRON_SECRET="synthetic-cron-secret-test";
const req={method:"GET",headers:{authorization:"Bearer synthetic-cron-secret-test"}};
function res(){return{code:200,value:null,setHeader(){},status(n){this.code=n;return this;},json(x){this.value=x;return this;}};}
test.after(()=>{if(previous===undefined)delete process.env.CRON_SECRET;else process.env.CRON_SECRET=previous;});
test("existing historical orders snapshot must be complete before daily archive",async()=>{
 const old=process.env.BLOB_READ_WRITE_TOKEN;process.env.BLOB_READ_WRITE_TOKEN="test";
 const reader=mock.method(state,"read",async()=>null);
 try{const out=res();await handler(req,out);
  assert.equal(out.code,200);assert.equal(out.value.paused,true);
  assert.equal(out.value.reason,"initial_orders_snapshot_not_verified");
 }finally{reader.mock.restore();if(old===undefined)delete process.env.BLOB_READ_WRITE_TOKEN;else process.env.BLOB_READ_WRITE_TOKEN=old;}
});
test("daily archive preserves original ledger, writes each changed-order page exactly once",async()=>{
 const old=process.env.BLOB_READ_WRITE_TOKEN;process.env.BLOB_READ_WRITE_TOKEN="test";
 const saves=[],args=[];
 const reader=mock.method(state,"read",async p=>p.includes("orders-stage-state")?{completed:true}:null);
 const writer=mock.method(state,"save",async (path,data)=>saves.push({path,data}));
 const query=mock.method(shopify,"queryShopify",async (_q,vars)=>{
  args.push(vars);
  return {orders:{pageInfo:{hasNextPage:false,endCursor:null},nodes:[{
   id:"gid://shopify/Order/101",name:"#101",createdAt:"2026-11-08T01:00:00Z",
   processedAt:"2026-11-08T01:01:00Z",updatedAt:"2026-11-08T03:00:00Z",
   test:false,cancelledAt:null,displayFinancialStatus:"PARTIALLY_REFUNDED",
   displayFulfillmentStatus:"FULFILLED",customer:{id:"gid://shopify/Customer/21"},
   currentSubtotalPriceSet:{shopMoney:{amount:"90",currencyCode:"USD"}},
   totalRefundedSet:{shopMoney:{amount:"10",currencyCode:"USD"}},
   currentTotalPriceSet:{shopMoney:{amount:"110",currencyCode:"USD"}},
   lineItems:{pageInfo:{hasNextPage:false},nodes:[{title:"Vajra Pendant",quantity:1}]}
  }]}};
 });
 try{
  const out=res();await handler(req,out);
  assert.equal(out.code,200);assert.equal(out.value.completed,true);
  assert.equal(out.value.counters.scanned,1);
  assert.match(args[0].filter,/updated_at:>=/);
  assert.equal(saves.length,2);
  assert.match(saves[0].path,/\/orders\/\d{4}-\d{2}-\d{2}\/(before_work|after_store_midnight|before_close)\/page-0.json$/);
  assert.equal(saves[0].data.orders[0].totalRefunded.amount,"10");
  assert.equal(saves[0].data.orders[0].ledgerStatus,"pending_full_history_financial_audit");
  assert.match(saves[1].path,/orders-state.json$/);
 }finally{for(const x of [reader,writer,query])x.mock.restore();
  if(old===undefined)delete process.env.BLOB_READ_WRITE_TOKEN;else process.env.BLOB_READ_WRITE_TOKEN=old;}
});
