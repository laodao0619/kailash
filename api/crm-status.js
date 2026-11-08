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
    const [state,shopify,gmail,gmailStage]=await Promise.all([
      readJson("crm-execution/tasks.json"),
      readJson("crm-execution/import-cursor.json"),
      readJson("crm-execution/gmail-filtered-cursor.json"),
      readJson("crm-execution/gmail-stage-state.json")
    ]);
    if(!state)return res.status(503).json({ok:false,status:"not_initialized"});
    return res.status(200).json({
      ok:true,
      project:"Kailash Energy CRM 2.0",
      updated_at:state.updated_at||null,
      tasks:(state.tasks||[]).map(x=>({id:x.id,status:x.status,last_run_at:x.last_run_at||null})),
      last_event_at:(state.log||[]).at(-1)?.at||null,
      imports:{
        shopify:{completed:!!shopify?.shopifyCycleComplete,totals:shopify?.shopifyTotals||null,quality_version:shopify?.qualityVersion||null,invalid_existing_removed:shopify?.qualityAudit?.existingRemoved||0,paid_suspicious_excluded_existing:shopify?.qualityAudit?.existingFlaggedPaid||0,subscription_views_configured:shopify?.viewSetVersion==="v2",last_checkpoint:shopify?.updatedAt||null},
        gmail:{completed:!!gmail?.finished,totals:gmail?.totals||null,last_checkpoint:gmail?.updatedAt||null,filter:"365 days, human inbound only, matched customer, one record per thread",prescreen:{started:!!gmailStage,completed:!!gmailStage?.completed,pages:gmailStage?.page||0,totals:gmailStage?.totals||null,last_checkpoint:gmailStage?.updatedAt||null}}
      },
      source_connectors:{
        shopify_backend_authorized:!!(process.env.SHOPIFY_SHOP_DOMAIN&&(process.env.SHOPIFY_ADMIN_ACCESS_TOKEN||(process.env.SHOPIFY_CLIENT_ID&&process.env.SHOPIFY_CLIENT_SECRET))),
        gmail_backend_authorized:!!(process.env.GMAIL_REFRESH_TOKEN&&process.env.GMAIL_CLIENT_ID&&process.env.GMAIL_CLIENT_SECRET),
        note:"ChatGPT Shopify/Gmail connector permissions do not automatically grant access to the Vercel backend"
      }
    });
  }catch(e){return res.status(502).json({ok:false,status:"unavailable"});}
};
