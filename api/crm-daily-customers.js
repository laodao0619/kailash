"use strict";
/**
 * Resumable Shopify customer delta. Reuses the already-complete initial
 * customer baseline; never scans all historical customers, never writes RFM.
 */
const state=require("../lib/crm-daily-state");
const shopify=require("../lib/crm-shopify");
const feishu=require("../lib/crm-feishu");
const bulk=require("../lib/crm-bulk-feishu");
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
 let blockedStage="baseline_read";
 try{
  const initial=await state.read(BASELINE);
  if(initial?.shopifyCycleComplete!==true)
   return res.status(200).json({ok:true,paused:true,reason:"initial_customer_baseline_not_verified"});
  blockedStage="checkpoint_read";
  const checkpoint=state.cycle(await state.read(SOURCE));
  if(checkpoint.completed)return res.status(200).json({ok:true,completed:true,day:checkpoint.day,counters:checkpoint.counters});
  blockedStage="feishu_auth";
  const token=await feishu.tenantToken();
  let pages=0;
  const began=Date.now();
  // Advance the cursor only after the corresponding Feishu writes succeed.
  while(pages<6&&Date.now()-began<90000){
   const filter="updated_at:>="+checkpoint.windowStart;
   blockedStage="shopify_page";
   const response=await shopify.queryShopify(QUERY,{filter,cursor:checkpoint.cursor||null});
   if(!response?.customers?.nodes||!response.customers.pageInfo)throw Error("Malformed customer delta response");
   const pageInfo=response.customers.pageInfo;
   // A non-advancing or missing cursor would replay already-written rows
   // indefinitely. Validate it before any Feishu lookups or writes.
   if(typeof pageInfo.hasNextPage!=="boolean"||
      (pageInfo.hasNextPage&&(
       typeof pageInfo.endCursor!=="string"||
       !pageInfo.endCursor.trim()||
       pageInfo.endCursor===checkpoint.cursor)))
    throw Error("Invalid or non-advancing Shopify customer delta cursor");
   const pageCounters={excluded:0,created:0,updated:0,accepted:0};
   const valid=[],index=new Map();
   blockedStage="customer_quality";
   for(const c of response.customers.nodes){
    const quality=classify(c);
    if(!quality.eligible){
     pageCounters.excluded++;
     // A paid suspicious account requires manual review, not deletion.
     continue;
    }
    valid.push(c);
   }
   // Read-only, bounded concurrency cuts latency without a whole-table scan.
   // Resolve *all* identities before any batch write. A failed/ambiguous
   // lookup must leave both Feishu and the saved page cursor untouched.
   blockedStage="customer_identity_lookup";
   const ids=valid.map(c=>c.id);
   if(new Set(ids).size!==ids.length)throw Error("Duplicate Shopify customer identity in delta page");
   const LOOKUP_BATCH=3;
   for(let offset=0;offset<valid.length;offset+=LOOKUP_BATCH){
    const batch=valid.slice(offset,offset+LOOKUP_BATCH);
    const matches=await Promise.all(batch.map(c=>
     feishu.findBy(token,bulk.CUSTOMERS,"Shopify客户ID",c.id)));
    for(let i=0;i<batch.length;i++){
     const existing=matches[i];
     if(!Array.isArray(existing)||existing.length>1)
      throw Error("Ambiguous Shopify identity in CRM mirror");
     if(existing.length===1)index.set(batch[i].id,existing[0].record_id);
    }
   }
   if(valid.length){
    // Shared historical field mapper preserves original numeric customer keys,
    // consent rules, and doesn't modify manually entered CRM grades or notes.
    blockedStage="feishu_batch_write";
    const result=await bulk.batchCustomers(token,valid,index);
    pageCounters.created=result.created;
    pageCounters.updated=result.updated;
    pageCounters.accepted=result.created+result.updated;
   }
   for(const [key,value] of Object.entries(pageCounters))
    checkpoint.counters[key]=(checkpoint.counters[key]||0)+value;
   checkpoint.counters.scanned+=response.customers.nodes.length;
   checkpoint.counters.pages++;
   checkpoint.cursor=response.customers.pageInfo.hasNextPage?response.customers.pageInfo.endCursor:null;
   if(!response.customers.pageInfo.hasNextPage)state.done(checkpoint);
   checkpoint.updatedAt=new Date().toISOString();
   blockedStage="checkpoint_save";
   await state.save(SOURCE,checkpoint);
   pages++;
   if(checkpoint.completed)break;
  }
  return res.status(200).json({ok:true,mode:"daily_customer_delta",day:checkpoint.day,
   completed:checkpoint.completed,continuedFrom:checkpoint.windowStart,
   pagesThisRun:pages,counters:checkpoint.counters,elapsedMs:Date.now()-began,
   note:"Historical import checkpoint preserved. CRM levels untouched."});
 }catch(_){
  // Deliberately log a fixed stage only: no customer PII, Shopify tokens, Feishu
  // response bodies, raw cursor values, or authorization details.
  console.error("[crm-daily-customers] blocked stage="+blockedStage);
  return res.status(502).json({ok:false,retryable:true,
   error:"daily_customer_delta_failed",blockedStage});
 }
};
