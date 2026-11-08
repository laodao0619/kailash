"use strict";
/**
 * Updated orders and refunds saved in private, daily, immutable-by-page
 * snapshots. The original 180-day/Shopify historical import is never reset.
 * This is an ingestion layer, NOT a financial/RFM writer.
 */
const state=require("../lib/crm-daily-state");
const shopify=require("../lib/crm-shopify");
const SOURCE=state.ROOT+"/orders-state.json";
const INITIAL="crm-execution/orders-stage-state.json";
const QUERY=`query CrmDailyOrders($filter:String!,$cursor:String){
 orders(first:35,after:$cursor,query:$filter,sortKey:UPDATED_AT){
  pageInfo{hasNextPage endCursor}
  nodes{id name createdAt processedAt updatedAt test cancelledAt
   displayFinancialStatus displayFulfillmentStatus customer{id}
   currentSubtotalPriceSet{shopMoney{amount currencyCode}}
   totalRefundedSet{shopMoney{amount currencyCode}}
   currentTotalPriceSet{shopMoney{amount currencyCode}}
   lineItems(first:30){pageInfo{hasNextPage}nodes{title quantity}}
  }
 }
}`;
module.exports=async(req,res)=>{
 res.setHeader("Cache-Control","private, no-store");
 if(req.method!=="GET")return res.status(405).json({ok:false});
 if(!state.authorized(req))return res.status(401).json({ok:false});
 if(!process.env.BLOB_READ_WRITE_TOKEN)return res.status(503).json({ok:false,error:"private_state_not_configured"});
 try{
  const baseline=await state.read(INITIAL);
  if(baseline?.completed!==true)
   return res.status(200).json({ok:true,paused:true,reason:"initial_orders_snapshot_not_verified"});
  const checkpoint=state.cycle(await state.read(SOURCE));
  if(checkpoint.completed)return res.status(200).json({ok:true,completed:true,day:checkpoint.day,counters:checkpoint.counters});
  const begin=Date.now();let pages=0;
  while(pages<8&&Date.now()-begin<90000){
   const filter="updated_at:>="+checkpoint.windowStart;
   const result=await shopify.queryShopify(QUERY,{filter,cursor:checkpoint.cursor||null});
   const connection=result.orders;
   if(!connection||!Array.isArray(connection.nodes)||!connection.pageInfo)
    throw Error("Malformed updated-order connection");
   const records=connection.nodes.map(o=>({
    id:o.id,name:o.name,createdAt:o.createdAt,processedAt:o.processedAt,
    updatedAt:o.updatedAt,test:!!o.test,cancelledAt:o.cancelledAt||null,
    financialStatus:o.displayFinancialStatus,fulfillmentStatus:o.displayFulfillmentStatus,
    customerId:o.customer?.id||null,
    currentSubtotal:o.currentSubtotalPriceSet?.shopMoney||null,
    totalRefunded:o.totalRefundedSet?.shopMoney||null,
    currentTotal:o.currentTotalPriceSet?.shopMoney||null,
    products:o.lineItems?.nodes||[],
    productsComplete:!o.lineItems?.pageInfo?.hasNextPage,
    ledgerStatus:"pending_full_history_financial_audit"
   }));
   // Write the page before advancing the checkpoint. A retry overwrites
   // the same page path rather than counting records twice in storage.
   const pagePath=state.ROOT+"/orders/"+checkpoint.day+"/"+(checkpoint.slot||"legacy")+"/page-"+checkpoint.counters.pages+".json";
   await state.save(pagePath,{asOf:new Date().toISOString(),windowStart:checkpoint.windowStart,orders:records});
   checkpoint.counters.scanned+=records.length;
   checkpoint.counters.accepted+=records.length;
   checkpoint.counters.pages++;
   checkpoint.cursor=connection.pageInfo.hasNextPage?connection.pageInfo.endCursor:null;
   if(!connection.pageInfo.hasNextPage)state.done(checkpoint);
   checkpoint.updatedAt=new Date().toISOString();
   await state.save(SOURCE,checkpoint);
   pages++;
   if(checkpoint.completed)break;
  }
  return res.status(200).json({ok:true,mode:"daily_order_change_archive",day:checkpoint.day,
   completed:checkpoint.completed,continuedFrom:checkpoint.windowStart,
   pagesThisRun:pages,counters:checkpoint.counters,
   note:"Only changed orders and refund state archived; never overwrites historical ledger or RFM grades."});
 }catch(_){return res.status(502).json({ok:false,retryable:true,error:"daily_orders_delta_failed"});}
};
