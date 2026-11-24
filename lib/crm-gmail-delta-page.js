"use strict";
// Private pending page contains source IDs, never message bodies.
// Do not advance the existing token until all page items are handled.
// Source-ID deduplication handles replay after a failed checkpoint save;
// counters are operational observations, not an exactly-once ledger.
function validatePage(p,cursor){
 if(!p||p.cursor!==(cursor||null)||!Array.isArray(p.ids)||
    p.ids.length>40||p.ids.some(id=>typeof id!=="string"||!id.trim())||
    new Set(p.ids).size!==p.ids.length||
    !Number.isSafeInteger(p.offset)||p.offset<0||p.offset>p.ids.length||
    !(p.next===null||(typeof p.next==="string"&&p.next.trim()&&p.next!==p.cursor)))
  throw Error("Invalid pending Gmail delta page");
}
async function runPages({checkpoint,deadline,maxPages,list,process,save,done,now=Date.now}){
 let pages=0,messages=0;
 async function persist(){
  checkpoint.updatedAt=new Date(now()).toISOString();
  await save(checkpoint);
 }
 while(!checkpoint.completed&&pages<maxPages&&now()<deadline){
  if(!checkpoint.pendingPage){
   const page=await list(checkpoint.cursor||null);
   // Gmail may omit messages for a genuinely empty result, but an arbitrary
   // successful JSON object must never advance the durable cursor.
   const validObject=page&&typeof page==="object"&&!Array.isArray(page)&&!page.error;
   const token=validObject?page.nextPageToken:undefined;
   const hasToken=token!==undefined&&token!==null;
   const validMessages=validObject&&(Array.isArray(page.messages)||
    (page.messages===undefined&&page.resultSizeEstimate===0&&!hasToken));
   if(!validMessages||(hasToken&&(typeof token!=="string"||!token.trim())))
    throw Error("Invalid Gmail delta list");
   const p={cursor:checkpoint.cursor||null,ids:(page.messages||[]).map(m=>m?.id),
    offset:0,next:page.nextPageToken||null};
   validatePage(p,checkpoint.cursor);
   checkpoint.pendingPage=p;
   await persist();
  }
  const p=checkpoint.pendingPage;
  validatePage(p,checkpoint.cursor);
  while(p.offset<p.ids.length&&now()<deadline){
   const outcome=await process(p.ids[p.offset]);
   if(!["excluded","duplicates","created","updated"].includes(outcome))
    throw Error("Invalid Gmail delta outcome");
   const counts=checkpoint.counters;
   counts.scanned=(counts.scanned||0)+1;
   counts[outcome]=(counts[outcome]||0)+1;
   if(outcome==="created"||outcome==="updated")counts.accepted=(counts.accepted||0)+1;
   p.offset++;
   await persist();
   messages++;
  }
  if(p.offset<p.ids.length)break;
  checkpoint.counters.pages=(checkpoint.counters.pages||0)+1;
  checkpoint.cursor=p.next;
  delete checkpoint.pendingPage;
  if(!p.next)done(checkpoint);
  await persist();
  pages++;
 }
 return {pages,messages};
}
module.exports={runPages};
