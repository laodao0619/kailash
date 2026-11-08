"use strict";
const crypto=require("node:crypto");
const {CURRENT,read}=require("./bi-index-build");
const SORT_KEYS=new Set(["name","country","tier","spendLifetime","ordersLifetime","m180","f180","rDays","lastOrderAt","aov","syncedAt","firstOrderAt"]);
let cache=null,inflight=null;
function auth(req){
 const expected=String(process.env.KBI_ACCESS_TOKEN||"");
 const actual=String(req.headers?.authorization||"").replace(/^Bearer\s+/i,"");
 if(expected.length<24||!actual)return false;
 return crypto.timingSafeEqual(crypto.createHash("sha256").update(expected).digest(),crypto.createHash("sha256").update(actual).digest());
}
async function snapshot(){
 if(cache&&Date.now()-cache.at<60000)return cache.data;
 if(!inflight)inflight=read(CURRENT).then(data=>{
  if(data?.version!==2||!Array.isArray(data.customers)||data.customers.length<1000)throw Error("index_not_ready");
  cache={at:Date.now(),data};return data;
 }).finally(()=>{inflight=null;});
 return inflight;
}
function safeNumber(s){
 if(s===null||s===undefined||s==="")return null;
 const n=Number(s);return Number.isFinite(n)?n:null;
}
function queryRows(items,params={}){
 const q=String(params.q||"").trim().toLocaleLowerCase().slice(0,100);
 const tier=String(params.tier||"").trim();
 const country=String(params.country||"").trim();
 const subscription=String(params.subscription||"").trim();
 const quality=String(params.quality||"").trim();
 const minM=safeNumber(params.minM),maxM=safeNumber(params.maxM);
 const minLifetime=safeNumber(params.minLifetime),maxLifetime=safeNumber(params.maxLifetime);
 const minF=safeNumber(params.minF),maxR=safeNumber(params.maxR);
 const minOrders=safeNumber(params.minOrders);
 const hasIssue=String(params.hasIssue||"");
 const sort=SORT_KEYS.has(params.sort)?params.sort:"lastOrderAt";
 const direction=params.dir==="asc"?1:-1;
 const matching=items.filter(c=>{
  if(q&&![c.name,c.email,c.id,c.country,c.nextAction].some(v=>String(v||"").toLocaleLowerCase().includes(q)))return false;
  if(tier&&c.tier!==tier)return false;
  if(country&&c.country!==country)return false;
  if(subscription&&c.subscription!==subscription)return false;
  if(quality&&c.quality!==quality)return false;
  for(const [v,min,max] of [[c.m180,minM,maxM],[c.spendLifetime,minLifetime,maxLifetime]]){
   if(min!==null&&(!Number.isFinite(v)||v<min))return false;
   if(max!==null&&(!Number.isFinite(v)||v>max))return false;
  }
  if(minF!==null&&(!Number.isFinite(c.f180)||c.f180<minF))return false;
  if(maxR!==null&&(!Number.isFinite(c.rDays)||c.rDays>maxR))return false;
  if(minOrders!==null&&(!Number.isFinite(c.ordersLifetime)||c.ordersLifetime<minOrders))return false;
  if(hasIssue==="yes"&&c.customerStatus!=="风险"&&!c.nextAction)return false;
  return true;
 });
 matching.sort((a,b)=>{
  const x=a[sort],y=b[sort],xn=x===null||x===undefined||x==="",yn=y===null||y===undefined||y==="";
  if(xn!==yn)return xn?1:-1; // Unknown fields always last
  let comp=0;
  if(sort==="tier"){
   const rank={"S+":7,"S":6,"A":5,"B":4,"基础客户":3,"沉睡":2,"从未购买":1,"待核验":0};
   comp=(rank[x]??-1)-(rank[y]??-1);
  }else if(typeof x==="number"&&typeof y==="number")comp=x-y;
  else comp=String(x??"").localeCompare(String(y??""),"zh-CN",{numeric:true,sensitivity:"base"});
  return comp?comp*direction:String(a.id).localeCompare(String(b.id),undefined,{numeric:true});
 });
 return matching;
}
function facets(rows){
 const tally=key=>Object.entries(rows.reduce((acc,r)=>{
  const value=String(r[key]||"未注明");
  acc[value]=(acc[value]||0)+1;return acc;
 },{})).sort((a,b)=>b[1]-a[1]).map(([value,count])=>({value,count}));
 return {tiers:tally("tier"),countries:tally("country"),subscriptions:tally("subscription"),quality:tally("quality")};
}
module.exports=async(req,res)=>{
 res.setHeader("Cache-Control","private, no-store");
 res.setHeader("X-Content-Type-Options","nosniff");
 if(req.method!=="GET")return res.status(405).json({ok:false,error:"method"});
 if(!process.env.KBI_ACCESS_TOKEN)return res.status(503).json({ok:false,error:"kbi_auth_not_configured"});
 if(!auth(req))return res.status(401).json({ok:false,error:"unauthorized"});
 try{
  const data=await snapshot();
  const p=req.query||{};
  const page=Math.max(1,Math.min(100000,parseInt(p.page,10)||1));
  const size=[25,50,100].includes(Number(p.size))?Number(p.size):50;
  const results=queryRows(data.customers,p);
  const view=results.slice((page-1)*size,page*size);
  return res.status(200).json({
   ok:true,source:data.source,asOf:data.generatedAt,slot:data.slot,
   total:results.length,masterTotal:data.total,page,pageSize:size,pageCount:Math.ceil(results.length/size),
   customers:view,facets:facets(data.customers),
   coverage:{
    snapshot:"existing_feishu_customer_master",
    tier:"existing_historical_writeback_not_final_financial_audit",
    m180:"existing_180d_snapshot_not_full_history",
    lastUpdated:data.generatedAt
   }
  });
 }catch(e){
  return res.status(503).json({ok:false,error:"crm_index_not_ready",
   note:"The existing CRM snapshot index is building; original customer data is not being reimported."});
 }
};
module.exports.queryRows=queryRows;
module.exports.facets=facets;
module.exports.snapshot=snapshot;
