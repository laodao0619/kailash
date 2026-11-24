"use strict";
/**
 * Human inbound Gmail daily delta, matched to a unique CRM customer.
 * Uses existing historical import, a new resumable cursor, and message-ID
 * idempotency; does not enumerate the entire historical mailbox.
 */
const state=require("../lib/crm-daily-state");
const {runPages}=require("../lib/crm-gmail-delta-page");
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
 const deadline=Date.now()+75000;
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
  const progress=await runPages({
   checkpoint, deadline, maxPages:4,
   list:cursor=>gmail.listMessages(mailToken,{
    pageToken:cursor||undefined,maxResults:40,after:checkpoint.windowStart
   }),
   process:async id=>{
    const m=await gmail.message(mailToken,id);
    if(gmail.classifyMessage(m)!=="candidate")return "excluded";
    const c=gmail.compactMessage(m);
    const email=c.from?.trim().toLowerCase();
    if(!email)return "excluded";
    const owners=await feishu.findBy(feishuToken,TABLE,"邮箱",email);
    if(owners.length!==1||owners[0]?.fields?.["客户数据状态"]==="待人工复核")return "excluded";
    const prior=await feishu.findBy(feishuToken,"tblNi7C5q5FYlG06","数据来源ID","gmail:"+c.id);
    if(prior.length)return "duplicates";
    const result=await feishu.upsertGmail(feishuToken,{...c,customerEmail:email});
    if(result!=="created"&&result!=="updated")throw Error("Unexpected Gmail upsert result");
    return result;
   },
   save:cp=>state.save(SOURCE,cp),done:cp=>state.done(cp)
  });
  return res.status(200).json({ok:true,mode:"daily_gmail_delta",day:checkpoint.day,
   completed:checkpoint.completed,continuedFrom:checkpoint.windowStart,
   pagesThisRun:progress.pages,messagesThisRun:progress.messages,counters:checkpoint.counters,
   historicalGmailComplete,
   note:"Historical Gmail cursor preserved; new messages idempotent by Gmail message ID."});
 }catch(_){return res.status(502).json({ok:false,retryable:true,error:"daily_gmail_delta_failed"});}
};
