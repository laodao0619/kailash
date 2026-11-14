"use strict";
/** Bounded human-inbound Gmail delta; never alters historical import cursor. */
const state=require("../lib/crm-daily-state");
const gmail=require("../lib/crm-gmail");
const feishu=require("../lib/crm-feishu");
const BASELINE="crm-execution/gmail-filtered-cursor.json";
const CUSTOMER_BASELINE="crm-execution/import-cursor.json";
const SOURCE=state.ROOT+"/gmail-state.json";
const TABLE="tblbk7Ju6fcM1BXF";
// Production's 120-second limit: bound page size, messages and wall time.
const PAGE_SIZE=6,MAX_MESSAGES_PER_RUN=12,MAX_PAGES_PER_RUN=3,SOFT_DEADLINE_MS=65000;
function validPage(p){
 return p&&Array.isArray(p.ids)&&p.ids.length<=PAGE_SIZE&&
  p.ids.every(id=>typeof id==="string"&&id.length>0)&&
  new Set(p.ids).size===p.ids.length&&
  Number.isSafeInteger(p.offset)&&p.offset>=0&&p.offset<=p.ids.length&&
  (p.nextCursor===null||(typeof p.nextCursor==="string"&&p.nextCursor.length>0));
}
module.exports=async(req,res)=>{
 res.setHeader("Cache-Control","private, no-store");
 if(req.method!=="GET")return res.status(405).json({ok:false});
 if(!state.authorized(req))return res.status(401).json({ok:false});
 if(!process.env.BLOB_READ_WRITE_TOKEN)return res.status(503).json({ok:false,error:"private_state_not_configured"});
 try{
  const [initial,customers]=await Promise.all([state.read(BASELINE),state.read(CUSTOMER_BASELINE)]);
  if(customers?.shopifyCycleComplete!==true)
   return res.status(200).json({ok:true,paused:true,reason:"initial_customer_baseline_not_verified"});
  const historicalGmailComplete=initial?.finished===true;
  const checkpoint=state.cycle(await state.read(SOURCE));
  if(checkpoint.completed)return res.status(200).json({ok:true,completed:true,day:checkpoint.day,slot:checkpoint.slot,counters:checkpoint.counters});
  if(checkpoint.pendingPage&&(!validPage(checkpoint.pendingPage)||
     (checkpoint.pendingPage.nextCursor&&checkpoint.pendingPage.nextCursor===checkpoint.cursor)))
   throw Error("Invalid pending Gmail page checkpoint");
  const [mailToken,feishuToken]=await Promise.all([gmail.token(),feishu.tenantToken()]);
  let pages=0,messages=0;
  const began=Date.now();
  while(pages<MAX_PAGES_PER_RUN&&messages<MAX_MESSAGES_PER_RUN&&Date.now()-began<SOFT_DEADLINE_MS){
   if(!checkpoint.pendingPage){
    const list=await gmail.listMessages(mailToken,{
     pageToken:checkpoint.cursor||undefined,maxResults:PAGE_SIZE,after:checkpoint.windowStart
    });
    if(!list||!Array.isArray(list.messages||[])||
      (list.nextPageToken!=null&&(typeof list.nextPageToken!=="string"||!list.nextPageToken)))
      throw Error("Malformed Gmail incremental page");
    const ids=(list.messages||[]).map(x=>x?.id);
    const nextCursor=list.nextPageToken||null;
    if(ids.length>PAGE_SIZE||ids.some(x=>typeof x!=="string"||!x)||
      new Set(ids).size!==ids.length||
      (nextCursor&&nextCursor===checkpoint.cursor))throw Error("Invalid Gmail incremental page cursor");
    // Save exact message IDs privately before processing; Gmail pages can shift.
    checkpoint.pendingPage={ids,offset:0,nextCursor};
    checkpoint.updatedAt=new Date().toISOString();
    await state.save(SOURCE,checkpoint);
   }
   const page=checkpoint.pendingPage;
   while(page.offset<page.ids.length&&messages<MAX_MESSAGES_PER_RUN&&Date.now()-began<SOFT_DEADLINE_MS){
    const id=page.ids[page.offset];
    const m=await gmail.message(mailToken,id);
    // Preserve the queued Gmail identity across API reads and Feishu writes.
    // A mismatched message must never be attached to the wrong customer.
    if(!m||m.id!==id)throw Error("Gmail message identity mismatch");
    checkpoint.counters.scanned++;
    if(gmail.classifyMessage(m)!=="candidate")checkpoint.counters.excluded++;
    else{
     const c=gmail.compactMessage(m);
     if(!c||c.id!==id)throw Error("Gmail compact identity mismatch");
     const email=c.from?.trim().toLowerCase();
     if(!email)checkpoint.counters.excluded++;
     else{
      const owners=await feishu.findBy(feishuToken,TABLE,"邮箱",email);
      if(owners.length>1)throw Error("Ambiguous customer email identity in CRM Gmail delta");
      if(owners.length===0||owners[0]?.fields?.["客户数据状态"]==="待人工复核")
       checkpoint.counters.excluded++;
      else{
       const prior=await feishu.findBy(feishuToken,"tblNi7C5q5FYlG06","数据来源ID","gmail:"+c.id);
       if(prior.length>1)throw Error("Duplicate Gmail source identity in CRM delta");
       if(prior.length===1)checkpoint.counters.duplicates++;
       else{
        const result=await feishu.upsertGmail(feishuToken,{...c,customerEmail:email});
        checkpoint.counters[result==="created"?"created":"updated"]++;
        checkpoint.counters.accepted++;
       }
      }
     }
    }
    page.offset++;
    messages++;
    checkpoint.updatedAt=new Date().toISOString();
    // A failed save following an upsert is retried idempotently by Gmail ID.
    await state.save(SOURCE,checkpoint);
   }
   if(page.offset<page.ids.length)break;
   checkpoint.pendingPage=null;
   checkpoint.cursor=page.nextCursor;
   checkpoint.counters.pages++;
   if(!page.nextCursor)state.done(checkpoint);
   checkpoint.updatedAt=new Date().toISOString();
   await state.save(SOURCE,checkpoint);
   pages++;
   if(checkpoint.completed)break;
  }
  return res.status(200).json({ok:true,mode:"daily_gmail_delta",day:checkpoint.day,
   slot:checkpoint.slot,completed:checkpoint.completed,continuedFrom:checkpoint.windowStart,
   pagesThisRun:pages,messagesThisRun:messages,counters:checkpoint.counters,
   historicalGmailComplete,
   note:"Private per-message checkpoint; historical Gmail import preserved."});
 }catch(_){return res.status(502).json({ok:false,retryable:true,error:"daily_gmail_delta_failed"});}
};
