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
 let stage="baseline_read";
 try{
  const initial=await state.read(BASELINE);
  if(initial?.shopifyCycleComplete!==true)
   return res.status(200).json({ok:true,paused:true,reason:"initial_customer_baseline_not_verified"});
  stage="checkpoint_read";
  const checkpoint=state.cycle(await state.read(SOURCE));
  if(checkpoint.completed)return res.status(200).json({ok:true,completed:true,day:checkpoint.day,counters:checkpoint.counters});
  stage="feishu_auth";
  const token=await feishu.tenantToken();
  let pages=0;
  const began=Date.now();
  // Leave headroom below the 120s function cap before starting another page.
  // An individual upstream operation can still time out; the next cron resumes.
  const safeStartBudgetMs=65000;
  // Advance the cursor only after the corresponding Feishu writes succeed.
  while(pages<6&&Date.now()-began<safeStartBudgetMs){
   const pageStarted=Date.now();
   const filter="updated_at:>="+checkpoint.windowStart;
   stage="shopify_query";
   console.info("[crm-daily-customers] stage_start stage="+stage+" page_in_run="+(pages+1));
   const response=await shopify.queryShopify(QUERY,{filter,cursor:checkpoint.cursor||null});
   const queriedAt=Date.now();
   stage="shopify_page_validation";
   const nodes=response?.customers?.nodes;
   const pageInfo=response?.customers?.pageInfo;
   if(!Array.isArray(nodes)||!pageInfo||typeof pageInfo.hasNextPage!=="boolean")
    throw Error("Malformed customer delta response");
   // A malformed or non-advancing cursor can silently replay the same page,
   // duplicate Feishu updates and keep this old checkpoint open indefinitely.
   // Fail before any Feishu lookup/write; preserve the last committed cursor.
   if(pageInfo.hasNextPage&&
      (!nodes.length||typeof pageInfo.endCursor!=="string"||
       !pageInfo.endCursor.trim()||pageInfo.endCursor===checkpoint.cursor))
    throw Error("Customer delta cursor not advancing");
   const pageCounters={excluded:0,created:0,updated:0,accepted:0};
   const valid=[],index=new Map(),seen=new Set();
   for(const c of nodes){
    stage="customer_quality";
    const quality=classify(c);
    if(!quality.eligible){
     pageCounters.excluded++;
     // A paid suspicious account requires manual review, not deletion.
     continue;
    }
    if(!c.id||seen.has(c.id))throw Error("Invalid or repeated customer ID in Shopify page");
    seen.add(c.id);
    valid.push(c);
   }
   // Feishu lookups were previously serial (up to 30 per page), increasing
   // the risk of hitting Vercel's 120s runtime cap before checkpoint save.
   // Bound concurrency to three and validate the entire page before ANY
   // mutation. A failed/ambiguous lookup leaves its prior cursor untouched.
   stage="feishu_customer_lookup";
   console.info("[crm-daily-customers] stage_start stage="+stage+" page_in_run="+(pages+1));
   for(let offset=0;offset<valid.length;offset+=3){
    const matches=await Promise.all(valid.slice(offset,offset+3).map(async c=>({
     id:c.id,records:await feishu.findBy(token,bulk.CUSTOMERS,"Shopify客户ID",c.id)
    })));
    for(const match of matches){
     if(!Array.isArray(match.records)||match.records.length>1)
      throw Error("Invalid or ambiguous Shopify identity in CRM mirror");
     if(match.records.length===1)index.set(match.id,match.records[0].record_id);
    }
   }
   const lookedUpAt=Date.now();
   if(valid.length){
    // Shared historical field mapper preserves original numeric customer keys,
    // consent rules, and doesn't modify manually entered CRM grades or notes.
    stage="feishu_batch_write";
    console.info("[crm-daily-customers] stage_start stage="+stage+" page_in_run="+(pages+1));
    const result=await bulk.batchCustomers(token,valid,index);
    pageCounters.created=result.created;
    pageCounters.updated=result.updated;
    pageCounters.accepted=result.created+result.updated;
   }
   const wroteAt=Date.now();
   for(const [key,value] of Object.entries(pageCounters))
    checkpoint.counters[key]=(checkpoint.counters[key]||0)+value;
   checkpoint.counters.scanned+=response.customers.nodes.length;
   checkpoint.counters.pages++;
   checkpoint.cursor=response.customers.pageInfo.hasNextPage?response.customers.pageInfo.endCursor:null;
   if(!response.customers.pageInfo.hasNextPage)state.done(checkpoint);
   checkpoint.updatedAt=new Date().toISOString();
   stage="checkpoint_save";
   console.info("[crm-daily-customers] stage_start stage="+stage+" page_in_run="+(pages+1));
   await state.save(SOURCE,checkpoint);
   // One PII-free log for each *committed* page. Timings identify the slow
   // upstream stage without revealing raw customer records, IDs or cursors.
   const savedAt=Date.now();
   console.info("[crm-daily-customers] page_committed "+
    "shopify_ms="+(queriedAt-pageStarted)+" "+
    "identity_ms="+(lookedUpAt-queriedAt)+" "+
    "write_ms="+(wroteAt-lookedUpAt)+" "+
    "checkpoint_ms="+(savedAt-wroteAt)+" "+
    "page_ms="+(savedAt-pageStarted)+" "+
    "scanned="+nodes.length+" eligible="+valid.length+" "+
    "completed="+checkpoint.completed);
   pages++;
   if(checkpoint.completed)break;
  }
  return res.status(200).json({ok:true,mode:"daily_customer_delta",day:checkpoint.day,
   completed:checkpoint.completed,continuedFrom:checkpoint.windowStart,
   pagesThisRun:pages,counters:checkpoint.counters,
   note:"Historical import checkpoint preserved. CRM levels untouched."});
 }catch(_){
  // Only emit a fixed workflow stage. Never log exception text, customer data,
  // Shopify cursor/filter, tokens, or upstream response bodies.
  console.error("[crm-daily-customers] daily_customer_delta_failed stage="+stage);
  return res.status(502).json({ok:false,retryable:true,error:"daily_customer_delta_failed"});
 }
};
