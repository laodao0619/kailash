const {get}=require("@vercel/blob");
async function readJson(path){
 try{
  const file=await get(path,{access:"private"});
  if(!file||file.statusCode!==200)return null;
  const chunks=[];for await(const ch of file.stream)chunks.push(ch);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
 }catch{return null;}
}
module.exports=async(req,res)=>{
  res.setHeader("Cache-Control","no-store");
  if(req.method!=="GET") return res.status(405).json({ok:false});
  try{
    const [state,shopify,gmail,gmailStage,ordersStage,ordersReconcile,dailyCustomers,dailyOrders,dailyGmail,caseSync]=await Promise.all([
      readJson("crm-execution/tasks.json"),
      readJson("crm-execution/import-cursor.json"),
      readJson("crm-execution/gmail-filtered-cursor.json"),
      readJson("crm-execution/gmail-stage-state.json"),
      readJson("crm-execution/orders-stage-state.json"),
      readJson("crm-execution/orders-reconcile-state.json"),
      readJson("crm-execution/daily-v1/shopify-state.json"),
      readJson("crm-execution/daily-v1/orders-state.json"),
      readJson("crm-execution/daily-v1/gmail-state.json"),
      readJson("crm-cases/v1/sync-state.json")
    ]);
    // A missing legacy tasks.json is not evidence that completed source
    // checkpoints were lost. Report all available baselines independently.
    const anyData=!!(state||shopify||gmail||gmailStage||ordersStage||ordersReconcile||dailyCustomers||dailyOrders||dailyGmail||caseSync);
    return res.status(200).json({
      ok:true,
      project:"Kailash Energy CRM 2.0",
      status:anyData?"checkpoint_available":"no_checkpoint_found",
      updated_at:state?.updated_at||shopify?.updatedAt||dailyCustomers?.updatedAt||null,
      tasks:(state?.tasks||[]).map(x=>({id:x.id,status:x.status,last_run_at:x.last_run_at||null})),
      last_event_at:(state?.log||[]).at(-1)?.at||null,
      imports:{
        shopify:{completed:!!shopify?.shopifyCycleComplete,totals:shopify?.shopifyTotals||null,quality_version:shopify?.qualityVersion||null,invalid_existing_removed:shopify?.qualityAudit?.existingRemoved||0,paid_suspicious_excluded_existing:shopify?.qualityAudit?.existingFlaggedPaid||0,subscription_views_configured:shopify?.viewSetVersion==="v2",last_checkpoint:shopify?.updatedAt||null},
        gmail:{completed:!!gmail?.finished,totals:gmail?.totals||null,last_checkpoint:gmail?.updatedAt||null,filter:"365 days, human inbound only, matched customer, one record per thread",prescreen:{started:!!gmailStage,completed:!!gmailStage?.completed,pages:gmailStage?.page||0,totals:gmailStage?.totals||null,last_checkpoint:gmailStage?.updatedAt||null}},
        orders_180d:{started:!!ordersStage,completed:!!ordersStage?.completed,pages:ordersStage?.page||0,totals:ordersStage?.totals||null,since:ordersStage?.since||null,last_checkpoint:ordersStage?.updatedAt||null},
        crm_grading:{started:!!ordersReconcile,completed:!!ordersReconcile?.done,totals:ordersReconcile?.totals||null,last_checkpoint:ordersReconcile?.updatedAt||null}
      },
      daily_incremental:{
        customers:{started:!!dailyCustomers,completed:!!dailyCustomers?.completed,day:dailyCustomers?.day||null,
          updated_at:dailyCustomers?.updatedAt||null,totals:dailyCustomers?.counters||null},
        orders:{started:!!dailyOrders,completed:!!dailyOrders?.completed,day:dailyOrders?.day||null,
          updated_at:dailyOrders?.updatedAt||null,totals:dailyOrders?.counters||null},
        gmail:{started:!!dailyGmail,completed:!!dailyGmail?.completed,day:dailyGmail?.day||null,
          updated_at:dailyGmail?.updatedAt||null,totals:dailyGmail?.counters||null}
      },
      customer_cases:{
        started:!!caseSync,
        last_checkpoint:caseSync?.lastRunAt||null,
        last_completed_cycle:caseSync?.completedCycleAt||null,
        scanned:caseSync?.scanned||0,
        accepted_events:caseSync?.accepted||0,
        excluded:caseSync?.excluded||0,
        note:"Case numbers are candidate events, not unique verified unresolved cases; detail endpoint requires authorization"
      },
      source_connectors:{
        shopify_backend_authorized:!!(process.env.SHOPIFY_SHOP_DOMAIN&&(process.env.SHOPIFY_ADMIN_ACCESS_TOKEN||(process.env.SHOPIFY_CLIENT_ID&&process.env.SHOPIFY_CLIENT_SECRET))),
        gmail_backend_authorized:!!(process.env.GMAIL_REFRESH_TOKEN&&process.env.GMAIL_CLIENT_ID&&process.env.GMAIL_CLIENT_SECRET),
        note:"ChatGPT Shopify/Gmail connector permissions do not automatically grant access to the Vercel backend"
      }
    });
  }catch(e){return res.status(502).json({ok:false,status:"unavailable"});}
};
