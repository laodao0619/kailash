"use strict";
const crypto=require("node:crypto");
const {tenantToken,request}=require("../lib/crm-feishu");
const APP="Y7VvbgreAasoLtsYdhrcmmDUn5d";
const CUSTOMER="tblbk7Ju6fcM1BXF", CONTACTS="tblNi7C5q5FYlG06";
const SIZE=50;
function auth(req){
 const secret=process.env.KBI_ACCESS_TOKEN||"";
 const given=(req.headers.authorization||"").replace(/^Bearer\s+/i,"");
 if(secret.length<24||!given)return false;
 const x=crypto.createHash("sha256").update(given).digest();
 const y=crypto.createHash("sha256").update(secret).digest();
 return crypto.timingSafeEqual(x,y);
}
function scalar(v){
 if(Array.isArray(v))return v.map(x=>typeof x==="string"?x:x?.text||"").join("");
 if(v&&typeof v==="object"&&"text"in v)return String(v.text||"");
 return v??null;
}
function number(v){const x=Number(scalar(v));return Number.isFinite(x)?x:null;}
function customer(x){
 const f=x.fields||{};
 return {id:String(scalar(f["Shopify客户ID"])||""),
   recordId:x.record_id,
   name:scalar(f["客户姓名"])||"",
   email:scalar(f["邮箱"])||"",
   country:scalar(f["国家地区"])||"",
   tier:scalar(f["CRM等级"])||null,
   subscribed:scalar(f["邮件订阅状态"])||null,
   lifetimeSpend:number(f["历史累计消费"]),
   lifetimeOrders:number(f["历史订单数"]),
   lastOrder:scalar(f["最近下单时间"])||null,
   nextAction:scalar(f["下一步行动"])||null,
   quality:scalar(f["客户数据状态"])||null,
   syncedAt:number(f["数据最后同步时间"])};
}
async function pages(token,table,maxPages=100){
 let cursor;const all=[];
 for(let n=0;n<maxPages;n++){
  const q=new URLSearchParams({page_size:"500"});
  if(cursor)q.set("page_token",cursor);
  const data=await request(token,"/bitable/v1/apps/"+APP+"/tables/"+table+"/records?"+q.toString());
  all.push(...(data.items||[]));
  if(!data.has_more)return {items:all,complete:true};
  cursor=data.page_token;
  if(!cursor)throw Error("Missing Feishu pagination token");
 }
 return {items:all,complete:false};
}
function sanitizeError(e){return /Feishu|OAuth|pagination/i.test(String(e.message))?"source_unavailable":"internal_error";}
module.exports=async(req,res)=>{
 res.setHeader("Cache-Control","private, no-store");
 res.setHeader("X-Content-Type-Options","nosniff");
 if(req.method!=="GET")return res.status(405).json({ok:false,error:"method"});
 if(!process.env.KBI_ACCESS_TOKEN)return res.status(503).json({ok:false,error:"kbi_access_not_configured"});
 if(!auth(req))return res.status(401).json({ok:false,error:"unauthorized"});
 try{
  const mode=String(req.query?.mode||"customers");
  const t=await tenantToken();
  if(mode==="customers"){
   const result=await pages(t,CUSTOMER);
   if(!result.complete)return res.status(503).json({ok:false,error:"incomplete_customer_scan"});
   const q=String(req.query?.q||"").trim().toLowerCase().slice(0,100);
   const tier=String(req.query?.tier||"").trim();
   const rows=result.items.map(customer).filter(x=>x.id&&(!x.quality||x.quality==="有效"));
   const matches=rows.filter(x=>(!tier||x.tier===tier)&&(!q||[x.name,x.email,x.id].some(s=>String(s).toLowerCase().includes(q))));
   const page=Math.max(1,Math.min(10000,parseInt(req.query?.page,10)||1));
   return res.status(200).json({ok:true,asOf:new Date().toISOString(),source:"Feishu CRM mirror (not final ledger)",total:matches.length,scanned:rows.length,page,pageSize:SIZE,customers:matches.slice((page-1)*SIZE,page*SIZE)});
  }
  if(mode==="customer"){
   const id=String(req.query?.id||"");
   if(!/^\d{5,25}$/.test(id))return res.status(400).json({ok:false,error:"invalid_id"});
   const [customers,communications]=await Promise.all([pages(t,CUSTOMER),pages(t,CONTACTS)]);
   if(!customers.complete||!communications.complete)return res.status(503).json({ok:false,error:"incomplete_scan"});
   const found=customers.items.map(customer).find(x=>x.id===id);
   if(!found)return res.status(404).json({ok:false,error:"customer_not_found"});
   const email=found.email.trim().toLowerCase();
   const events=communications.items.filter(x=>{
    const f=x.fields||{};
    const ce=String(scalar(f["客户邮箱"])||"").trim().toLowerCase();
    return email&&ce===email;
   }).slice(0,300).map(x=>{
    const f=x.fields||{};
    const date=number(f["记录时间"]);
    return {id:String(scalar(f["数据来源ID"])||x.record_id),kind:"communication",
      at:date?new Date(date).toISOString():null,
      title:String(scalar(f["邮件主题"])||"客户沟通").slice(0,180),
      channel:String(scalar(f["沟通渠道"])||"Gmail"),
      source:"Feishu mirror"};
   }).sort((a,b)=>String(b.at||"").localeCompare(String(a.at||"")));
   return res.status(200).json({ok:true,source:"Feishu CRM mirror",asOf:new Date().toISOString(),customer:found,events,coverage:{orders:"historical_order_lines_not_connected",acquisition:"not_connected",emails:"matched_by_unique_email_only; review duplicates"}});
  }
  return res.status(400).json({ok:false,error:"unknown_mode"});
 }catch(e){return res.status(502).json({ok:false,error:sanitizeError(e)});}
};
