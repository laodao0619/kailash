"use strict";
/**
 * Resumable Shopify customer delta. Reuses the already-complete initial
 * customer baseline; never scans all historical customers, never writes RFM.
 */
const state=require("../lib/crm-daily-state");
const shopify=require("../lib/crm-shopify");
const feishu=require("../lib/crm-feishu");
const {classify}=require("../lib/crm-customer-quality");
const SOURCE=state.ROOT+"/shopify-state.json";
const BASELINE="crm-execution/import-cursor.json";
const QUERY=`query CrmCustomerDelta($filter:String!,$cursor:String){
 customers(first:30,after:$cursor,query:$filter,sortKey:UPDATED_AT){
  pageInfo{hasNextPage endCursor}
  nodes{
   id firstName lastName createdAt updatedAt numberOfOrders lastOrder{processedAt}
   amountSpent{amount currencyCode}
   defaultEmailAddress{emailAddress marketingState marketingUpdatedAt validFormat}
   defaultAddress{country countryCodeV2}
   orders(first:1,sortKey:PROCESSED_AT){nodes{processedAt test cancelledAt}}
  }
 }
}`;
module.exports=async(req,res)=>{
 res.setHeader("Cache-Control","private, no-store");
 if(req.method!=="GET")return res.status(405).json({ok:false});
 if(!state.authorized(req))return res.status(401).json({ok:false});
 if(!process.env.BLOB_READ_WRITE_TOKEN)return res.status(503).json({ok:false,error:"private_state_not_configured"});
 try{
  const initial=await state.read(BASELINE);
  if(initial?.shopifyCycleComplete!==true)
   return res.status(200).json({ok:true,paused:true,reason:"initial_customer_baseline_not_verified"});
  const checkpoint=state.cycle(await state.read(SOURCE));
  if(checkpoint.completed)return res.status(200).json({ok:true,completed:true,day:checkpoint.day,counters:checkpoint.counters});
  const token=await feishu.tenantToken();
  let pages=0;
  const began=Date.now();
  // Advance the cursor only after the corresponding Feishu writes succeed.
  while(pages<6&&Date.now()-began<90000){
   const filter="updated_at:>="+checkpoint.windowStart;
   const response=await shopify.queryShopify(QUERY,{filter,cursor:checkpoint.cursor||null});
   if(!response?.customers?.nodes||!response.customers.pageInfo)throw Error("Malformed customer delta response");
   for(const c of response.customers.nodes){
    const quality=classify(c);
    if(!quality.eligible){
     checkpoint.counters.excluded++;
     // A paid suspicious account requires manual review, not deletion.
     continue;
    }
    const result=await feishu.upsertCustomer(token,c);
    checkpoint.counters[result==="created"?"created":"updated"]++;
    checkpoint.counters.accepted++;
   }
   checkpoint.counters.scanned+=response.customers.nodes.length;
   checkpoint.counters.pages++;
   checkpoint.cursor=response.customers.pageInfo.hasNextPage?response.customers.pageInfo.endCursor:null;
   if(!response.customers.pageInfo.hasNextPage)state.done(checkpoint);
   checkpoint.updatedAt=new Date().toISOString();
   await state.save(SOURCE,checkpoint);
   pages++;
   if(checkpoint.completed)break;
  }
  return res.status(200).json({ok:true,mode:"daily_customer_delta",day:checkpoint.day,
   completed:checkpoint.completed,continuedFrom:checkpoint.windowStart,
   pagesThisRun:pages,counters:checkpoint.counters,
   note:"Historical import checkpoint preserved. CRM levels untouched."});
 }catch(_){return res.status(502).json({ok:false,retryable:true,error:"daily_customer_delta_failed"});}
};
