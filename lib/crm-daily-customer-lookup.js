"use strict";
/**
 * Read-only, bounded Feishu customer ID lookups for one Shopify delta page.
 * All lookups must succeed before the caller can write any customer changes.
 * No full-table scan, shared cache, cursor movement, or new credentials.
 */
module.exports=async function lookupExistingCustomers(token,customers,findBy,table,{concurrency=3}={}){
 if(!Array.isArray(customers))throw Error("Customer delta page missing");
 if(typeof findBy!=="function"||!table)throw Error("Customer lookup unavailable");
 const ids=customers.map(c=>c?.id);
 if(ids.some(id=>!id||typeof id!=="string")||new Set(ids).size!==ids.length)
  throw Error("Duplicate or missing Shopify customer identity in delta page");
 if(!ids.length)return new Map();
 const recordIds=Array(ids.length).fill(null);
 const limit=Math.min(ids.length,Number.isInteger(concurrency)&&concurrency>0?Math.min(concurrency,3):3);
 let next=0;
 const worker=async()=>{
  while(next<ids.length){
   const at=next++;
   const matches=await findBy(token,table,"Shopify客户ID",ids[at]);
   if(!Array.isArray(matches))throw Error("Malformed Feishu customer lookup result");
   if(matches.length>1)throw Error("Ambiguous Shopify identity in CRM mirror");
   if(matches.length){
    if(!matches[0]?.record_id)throw Error("Feishu customer record ID missing");
    recordIds[at]=matches[0].record_id;
   }
  }
 };
 // Wait for every in-flight read to settle; failed pages cannot reach writes.
 const outcomes=await Promise.allSettled(Array.from({length:limit},()=>worker()));
 const error=outcomes.find(item=>item.status==="rejected");
 if(error)throw error.reason;
 const index=new Map();
 ids.forEach((id,i)=>{if(recordIds[i])index.set(id,recordIds[i]);});
 return index;
};
