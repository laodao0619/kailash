"use strict";
/**
 * Human inbound Gmail daily delta, matched to a unique CRM customer.
 * Uses existing historical import, a new resumable cursor, and message-ID
 * idempotency; does not enumerate the entire historical mailbox.
 */
const state=require("../lib/crm-daily-state");
const gmail=require("../lib/crm-gmail");
const feishu=require("../lib/crm-feishu");
const BASELINE="crm-execution/gmail-filtered-cursor.json";
const CUSTOMER_BASELINE="crm-execution/import-cursor.json";
const SOURCE=state.ROOT+"/gmail-state.json";
const TABLE="tblbk7Ju6fcM1BXF";
module.exports=async(req,res)=>{
 res.setHeader("Cache-Control","private, no-store");
 if(req.method!=="GET")return res.status(405).json({ok:false});
 if(!state.authorized(req))return res.status(401).json({ok:false});
 if(!process.env.BLOB_READ_WRITE_TOKEN)return res.status(503).json({ok:false,error:"private_state_not_configured"});
 try{
  const [initial,customers]=await Promise.all([state.read(BASELINE),state.read(CUSTOMER_BASELINE)]);
  if(customers?.shopifyCycleComplete!==true)
   return res.status(200).json({ok:true,paused:true,reason:"initial_customer_baseline_not_verified"});
  // Historical Gmail can still be finishing from its old cursor. New messages
  // are keyed by message ID; legacy records are keyed by thread ID. The two
  // streams never reset each other's checkpoints.
  const historicalGmailComplete=initial?.finished===true;
  const checkpoint=state.cycle(await state.read(SOURCE));
  if(checkpoint.completed)return res.status(200).json({ok:true,completed:true,day:checkpoint.day,counters:checkpoint.counters});
  const [mailToken,feishuToken]=await Promise.all([gmail.token(),feishu.tenantToken()]);
  let pages=0;
  const began=Date.now();
  while(pages<4&&Date.now()-began<80000){
   const list=await gmail.listMessages(mailToken,{
    pageToken:checkpoint.cursor||undefined,maxResults:40,after:checkpoint.windowStart
   });
   for(const item of list.messages||[]){
    checkpoint.counters.scanned++;
    const m=await gmail.message(mailToken,item.id);
    if(gmail.classifyMessage(m)!=="candidate"){checkpoint.counters.excluded++;continue;}
    const c=gmail.compactMessage(m);
    const email=c.from?.trim().toLowerCase();
    if(!email){checkpoint.counters.excluded++;continue;}
    const owners=await feishu.findBy(feishuToken,TABLE,"邮箱",email);
    if(owners.length!==1||owners[0]?.fields?.["客户数据状态"]==="待人工复核"){
     checkpoint.counters.excluded++;continue;
    }
    // Source ID is message-specific, allowing each customer reply in an
    // existing thread to be recorded. Existing import used thread IDs;
    // do not replace or reset those historical records.
    const prior=await feishu.findBy(feishuToken,"tblNi7C5q5FYlG06","数据来源ID","gmail:"+c.id);
    if(prior.length){checkpoint.counters.duplicates++;continue;}
    const result=await feishu.upsertGmail(feishuToken,{...c,customerEmail:email});
    checkpoint.counters[result==="created"?"created":"updated"]++;
    checkpoint.counters.accepted++;
   }
   checkpoint.counters.pages++;
   checkpoint.cursor=list.nextPageToken||null;
   if(!list.nextPageToken)state.done(checkpoint);
   checkpoint.updatedAt=new Date().toISOString();
   await state.save(SOURCE,checkpoint);
   pages++;
   if(checkpoint.completed)break;
  }
  return res.status(200).json({ok:true,mode:"daily_gmail_delta",day:checkpoint.day,
   completed:checkpoint.completed,continuedFrom:checkpoint.windowStart,
   pagesThisRun:pages,counters:checkpoint.counters,
   historicalGmailComplete,
   note:"Historical Gmail cursor preserved; new messages idempotent by Gmail message ID."});
 }catch(_){return res.status(502).json({ok:false,retryable:true,error:"daily_gmail_delta_failed"});}
};
