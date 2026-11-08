"use strict";
const crypto=require("node:crypto");
const {get,put}=require("@vercel/blob");
const ROOT="kbi-customer-notes/v1";
function authorized(req){
 const expected=String(process.env.KBI_ACCESS_TOKEN||"");
 const actual=String(req.headers?.authorization||"").replace(/^Bearer\s+/i,"");
 if(expected.length<24||!actual)return false;
 return crypto.timingSafeEqual(
  crypto.createHash("sha256").update(expected).digest(),
  crypto.createHash("sha256").update(actual).digest());
}
function pathFor(id){
 if(!/^\d{5,25}$/.test(String(id||"")))return null;
 return ROOT+"/customer-"+id+".json";
}
async function readNote(id){
 const path=pathFor(id);
 if(!path)throw Error("invalid_customer_id");
 const r=await get(path,{access:"private"});
 if(!r||r.statusCode===404)return {text:"",updatedAt:null,version:0};
 if(r.statusCode!==200)throw Error("private_note_read_failed");
 const chunks=[];for await(const x of r.stream)chunks.push(x);
 const j=JSON.parse(Buffer.concat(chunks).toString("utf8"));
 return {text:typeof j.text==="string"?j.text:"",
  updatedAt:typeof j.updatedAt==="string"?j.updatedAt:null,
  version:Number.isSafeInteger(j.version)?j.version:0};
}
module.exports=async(req,res)=>{
 res.setHeader("Cache-Control","private, no-store");
 res.setHeader("X-Content-Type-Options","nosniff");
 if(!["GET","PUT"].includes(req.method))return res.status(405).json({ok:false,error:"method_not_allowed"});
 if(!authorized(req))return res.status(401).json({ok:false,error:"unauthorized"});
 const id=String(req.query?.id||"");
 const path=pathFor(id);
 if(!path)return res.status(400).json({ok:false,error:"invalid_customer_id"});
 try{
  const existing=await readNote(id);
  if(req.method==="GET")return res.status(200).json({ok:true,...existing});
  const payload=typeof req.body==="string"?JSON.parse(req.body):req.body;
  if(!payload||typeof payload.text!=="string"||payload.text.length>10000||
   !Number.isSafeInteger(payload.version)||payload.version<0)
   return res.status(400).json({ok:false,error:"invalid_note"});
  if(payload.version!==existing.version)
   return res.status(409).json({ok:false,error:"note_changed_elsewhere",...existing});
  const value={text:payload.text.replace(/\r\n/g,"\n"),updatedAt:new Date().toISOString(),version:existing.version+1};
  await put(path,JSON.stringify(value),{
   access:"private",allowOverwrite:true,addRandomSuffix:false,contentType:"application/json"
  });
  return res.status(200).json({ok:true,...value});
 }catch(e){
  console.error("KBI_NOTE",String(e.message||e).slice(0,90));
  return res.status(503).json({ok:false,error:"note_storage_unavailable"});
 }
};
module.exports.pathFor=pathFor;
module.exports.readNote=readNote;
