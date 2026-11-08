"use strict";
const crypto=require("node:crypto");
const {get,put}=require("@vercel/blob");
const {snapshot}=require("./bi-customers-v2");
const audiences=require("./bi-audiences");
const {matches}=require("../lib/kbi-audience");
const {queryShopify}=require("../lib/crm-shopify");
const ROOT="kbi-operations/v1/audience-sync/";
function auth(req){
 const s=String(process.env.KBI_ACCESS_TOKEN||""),g=String(req.headers?.authorization||"").replace(/^Bearer\s+/i,"");
 return s.length>=24&&!!g&&crypto.timingSafeEqual(crypto.createHash("sha256").update(s).digest(),crypto.createHash("sha256").update(g).digest());
}
async function read(id){
 const r=await get(ROOT+id+".json",{access:"private"});
 if(!r||r.statusCode===404)return null;
 if(r.statusCode!==200)throw Error("sync_state_read_failed");
 const chunks=[];for await(const x of r.stream)chunks.push(x);
 return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
async function write(id,state){
 await put(ROOT+id+".json",JSON.stringify(state),{access:"private",allowOverwrite:true,addRandomSuffix:false,contentType:"application/json"});
}
async function createSegment(name,tag){
 const query="mutation($name:String!,$query:String!){segmentCreate(name:$name,query:$query){segment{id name}userErrors{field message}}}";
 const r=await queryShopify(query,{name:"KBI · "+name.slice(0,75)+" · "+tag,query:"customer_tags CONTAINS '"+tag+"'"});
 const d=r.segmentCreate;
 if(d?.userErrors?.length||!d?.segment?.id)throw Error("shopify_segment_create_failed");
 return d.segment.id;
}
async function pushBatch(ids,tag){
 const aliases=ids.map((id,i)=>"b"+i+':tagsAdd(id:"gid://shopify/Customer/'+id+'",tags:["'+tag+'"]){userErrors{field message}}').join(" ");
 const result=await queryShopify("mutation KbiAudienceTags{"+aliases+"}");
 const failures=ids.filter((_id,i)=>(result["b"+i]?.userErrors||[]).length>0);
 return failures;
}
module.exports=async(req,res)=>{
 res.setHeader("Cache-Control","private, no-store");
 if(!auth(req))return res.status(401).json({ok:false,error:"unauthorized"});
 if(!["GET","POST"].includes(req.method))return res.status(405).json({ok:false,error:"method"});
 const id=String(req.query?.id||"");
 if(!/^aud-[a-z0-9_-]{7,44}$/.test(id))return res.status(400).json({ok:false,error:"invalid_audience_id"});
 try{
  const all=await audiences.read();
  const saved=all.audiences.find(a=>a.id===id);
  if(!saved)return res.status(404).json({ok:false,error:"audience_not_found"});
  const data=await snapshot();
  const matched=matches(data.customers,saved.criteria);
  const state=await read(id);
  if(req.method==="GET")return res.status(200).json({ok:true,
   preview:{count:matched.ids.length,sourceAsOf:data.generatedAt,consentOnly:true,
    tag:"KBI_"+id,existingStatus:state?.status||"not_started",
    tagged:state?.position||0,shopifySegmentId:state?.segmentId||null},
   warning:"Adds tags to currently subscribed matching customers only. This is a frozen tagged cohort; old members are not automatically untagged."});
  const b=typeof req.body==="string"?JSON.parse(req.body):req.body||{};
  if(b.confirm!=="CONFIRM_SHOPIFY_AUDIENCE_SYNC"||b.sourceAsOf!==data.generatedAt)
   return res.status(409).json({ok:false,error:"confirmation_or_snapshot_mismatch"});
  if(matched.ids.length<1||matched.ids.length>10000)
   return res.status(422).json({ok:false,error:"invalid_audience_size"});
  if(state&&state.sourceAsOf!==data.generatedAt)
   return res.status(409).json({ok:false,error:"source_changed_create_new_audience_to_resync"});
  const tag="KBI_"+id;
  const progress=state||{version:1,sourceAsOf:data.generatedAt,position:0,
   tag,segmentId:null,status:"in_progress",total:matched.ids.length};
  if(progress.total!==matched.ids.length)return res.status(409).json({ok:false,error:"audience_changed_during_sync"});
  if(!progress.segmentId){
   progress.segmentId=await createSegment(saved.name,tag);
   await write(id,progress);
  }
  if(progress.position>=matched.ids.length){
   progress.status="complete";return res.status(200).json({ok:true,...progress});
  }
  const batch=matched.ids.slice(progress.position,progress.position+20);
  const failed=await pushBatch(batch,tag);
  if(failed.length){
   progress.status="partial_error";progress.lastErrorCount=failed.length;
   await write(id,progress);
   return res.status(502).json({ok:false,error:"shopify_partial_tag_failure",
    tagged:progress.position,batchFailed:failed.length,canRetry:true});
  }
  progress.position+=batch.length;progress.status=progress.position>=matched.ids.length?"complete":"in_progress";
  progress.updatedAt=new Date().toISOString();
  await write(id,progress);
  return res.status(200).json({ok:true,...progress,note:"Repeat the confirmed request to continue tagging the next 20 customers."});
 }catch(e){console.error("KBI_AUDIENCE_SYNC",String(e.message||e).slice(0,100));
  return res.status(503).json({ok:false,error:"shopify_audience_sync_unavailable",note:"Nothing is assumed completed; inspect progress before retrying."});}
};
module.exports.pushBatch=pushBatch;
