"use strict";
const crypto=require("node:crypto");
const {tenantToken}=require("../lib/crm-feishu");
async function request(t,path){
 const r=await fetch("https://open.feishu.cn/open-apis"+path,{headers:{Authorization:"Bearer "+t}});
 const j=await r.json().catch(()=>({}));
 if(!r.ok||j.code!==0)throw Error("Feishu read failed");
 return j.data||{};
}
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
function number(v){const raw=scalar(v);if(raw===null||raw===""||raw===undefined)return null;const x=Number(raw);return Number.isFinite(x)?x:null;}
function customer(x){
 const f=x.fields||{};
 return {id:String(scalar(f["Shopify客户ID"])||""),
   recordId:x.record_id,
   name:scalar(f["客户姓名"])||"",
   email:scalar(f["邮箱"])||"",
   country:scalar(f["国家地区"])||"",
   tier:require("../lib/crm-tier-policy").classify({lifetimeSpendUSD:number(f["历史累计消费"]),f180:number(f["近180天有效订单数"]),ordersLifetime:number(f["历史订单数"])}).tier,
   subscribed:scalar(f["邮件订阅状态"])||null,
   lifetimeSpend:number(f["历史累计消费"]),
   lifetimeOrders:number(f["历史订单数"]),
   lastOrder:scalar(f["最近下单时间"])||null,
   nextAction:scalar(f["下一步行动"])||null,
   quality:scalar(f["客户数据状态"])||null,
   syncedAt:number(f["数据最后同步时间"])};
}
let customerCache=null;
let customerCachePromise=null;
async function cachedCustomers(token){
 if(customerCache&&Date.now()-customerCache.at<90000)return customerCache.data;
 if(!customerCachePromise)customerCachePromise=pages(token,CUSTOMER).then(data=>{
  if(data.complete)customerCache={at:Date.now(),data};
  return data;
 }).finally(()=>{customerCachePromise=null;});
 return customerCachePromise;
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
async function searchExact(token,table,field,value,maxPages=5){
 const path="/bitable/v1/apps/"+APP+"/tables/"+table+"/records/search?page_size=100";
 let cursor;const all=[];
 for(let n=0;n<maxPages;n++){
  const q=cursor?path+"&page_token="+encodeURIComponent(cursor):path;
  const response=await fetch("https://open.feishu.cn/open-apis"+q,{
   method:"POST",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},
   body:JSON.stringify({filter:{conjunction:"and",conditions:[{field_name:field,operator:"is",value:[value]}]}})
  });
  const json=await response.json().catch(()=>({}));
  if(!response.ok||json.code!==0)throw Error("Feishu search failed");
  const data=json.data||{};
  all.push(...(data.items||[]));
  if(!data.has_more)return {items:all,complete:true};
  cursor=data.page_token;
  if(!cursor)break;
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
   const result=await cachedCustomers(t);
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
   // Exact server-side lookup avoids scanning 12k+ customers for each profile.
   const customers=await searchExact(t,CUSTOMER,"Shopify客户ID",id);
   if(!customers.complete||customers.items.length>1)
    return res.status(409).json({ok:false,error:"ambiguous_customer_id"});
   const found=customers.items.length?customer(customers.items[0]):null;
   if(!found)return res.status(404).json({ok:false,error:"customer_not_found"});
   const email=found.email.trim().toLowerCase();
   let communications={items:[],complete:true};
   if(email){
    // A shared email may belong to multiple Shopify customers. Do not
    // associate private messages unless the identity is unique.
    const emailOwners=await searchExact(t,CUSTOMER,"邮箱",email);
    if(!emailOwners.complete||emailOwners.items.filter(x=>String(scalar(x.fields?.["Shopify客户ID"])||"")).length!==1)
     return res.status(200).json({ok:true,source:"Feishu CRM mirror",asOf:new Date().toISOString(),customer:found,events:[],
      coverage:{orders:"historical_order_lines_not_connected",acquisition:"not_connected",emails:"ambiguous_email; not linked"}});
    communications=await searchExact(t,CONTACTS,"客户邮箱",email);
    if(!communications.complete)return res.status(503).json({ok:false,error:"incomplete_communication_scan"});
   }
   const events=communications.items.slice(0,300).map(x=>{
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
