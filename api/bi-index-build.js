"use strict";
const crypto=require("node:crypto");
const {get,put}=require("@vercel/blob");
const {tenantToken}=require("../lib/crm-feishu");
const APP="Y7VvbgreAasoLtsYdhrcmmDUn5d";
const TABLE="tblbk7Ju6fcM1BXF";
const ROOT="kbi-index/v2";
const CURRENT=ROOT+"/current.json",STATE=ROOT+"/build-state.json";
function textValue(x){
 if(x===null||x===undefined)return "";
 if(Array.isArray(x))return x.map(textValue).join(" ").trim();
 if(typeof x==="object")return String(x.text||x.name||x.value||"");
 return String(x);
}
function num(x){
 const raw=textValue(x).replace(/,/g,"").trim();
 if(raw==="")return null;
 const n=Number(raw);
 return Number.isFinite(n)?n:null;
}
function millis(x){
 const raw=textValue(x).trim();
 if(!raw)return null;
 const n=Number(raw);
 if(Number.isFinite(n)&&n>1e11)return n;
 if(Number.isFinite(n)&&n>1e9)return n*1000;
 const v=Date.parse(raw);
 return Number.isFinite(v)?v:null;
}
function normalize(item){
 const f=item.fields||{};
 const gid=textValue(f["Shopify客户ID"]);
 if(!/^gid:\/\/shopify\/Customer\/\d+$/.test(gid))return null;
 return require("../lib/crm-tier-policy").applyRow({
  id:gid.split("/").at(-1),gid,recordId:item.record_id,
  name:textValue(f["客户姓名"]),email:textValue(f["邮箱"]).toLowerCase(),
  country:textValue(f["国家地区"]),quality:textValue(f["客户数据状态"])||"未核验",
  subscription:textValue(f["邮件订阅状态"])||"未知",
  tier:textValue(f["CRM等级"])||"待核验",
  segment:textValue(f["RFM价值分群"])||"",
  spendLifetime:num(f["历史累计消费"]),ordersLifetime:num(f["历史订单数"]),
  m180:num(f["近180天净消费"]),f180:num(f["近180天有效订单数"]),
  rDays:num(f["最近购买距今天数R"]),
  lastOrderAt:millis(f["最近下单日期"]||f["最近下单时间"]),
  firstOrderAt:millis(f["首次下单时间"]),
  firstSubscribedAt:millis(f["首次订阅时间"]),
  consentAt:millis(f["订阅状态更新时间"]),
  syncedAt:millis(f["数据最后同步时间"]),
  nextAction:textValue(f["下一步行动"]),
  customerStatus:textValue(f["客户状态"]),
  nextFollowupAt:millis(f["建议下一次维护日期"]),
  aov:num(f["历史累计消费"])!==null&&num(f["历史订单数"])>0?
   Math.round(num(f["历史累计消费"])/num(f["历史订单数"])*100)/100:null
 });
}
function authorized(req){
 const expected=process.env.CRON_SECRET||"",actual=String(req.headers?.authorization||"").replace(/^Bearer\s+/i,"");
 if(!expected||!actual)return false;
 return crypto.timingSafeEqual(crypto.createHash("sha256").update(expected).digest(),crypto.createHash("sha256").update(actual).digest());
}
async function read(path){
 const r=await get(path,{access:"private"});
 if(!r||r.statusCode===404)return null;
 if(r.statusCode!==200)throw Error("blob_read_failed");
 const chunks=[];for await(const chunk of r.stream)chunks.push(chunk);
 return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
async function write(path,obj){
 return put(path,JSON.stringify(obj),{access:"private",allowOverwrite:true,addRandomSuffix:false,contentType:"application/json"});
}
function slotAt(now=new Date()){
 const at=new Date(now.getTime()+8*3600000);
 const day=at.toISOString().slice(0,10);
 const minute=at.getUTCHours()*60+at.getUTCMinutes();
 // Rebuild only after the source delta windows have finished:
 // 09:05, 13:30, 16:00 Beijing. Overnight reuse yesterday's snapshot.
 if(minute<9*60+5){
  const yesterday=new Date(at.getTime()-86400000).toISOString().slice(0,10);
  return yesterday+"-afternoon";
 }
 if(minute<13*60+30)return day+"-morning";
 if(minute<16*60)return day+"-noon";
 return day+"-afternoon";
}
async function fetchPage(token,cursor){
 const q=new URLSearchParams({page_size:"500"});
 if(cursor)q.set("page_token",cursor);
 const r=await fetch("https://open.feishu.cn/open-apis/bitable/v1/apps/"+APP+"/tables/"+TABLE+"/records?"+q,{headers:{Authorization:"Bearer "+token}});
 const json=await r.json().catch(()=>({}));
 if(!r.ok||json.code!==0||!json.data)throw Error("feishu_page_failed");
 return json.data;
}
function nextCycle(previous,now=new Date()){
 const slot=slotAt(now);
 if(previous&&!previous.complete)return previous;
 if(previous&&previous.complete&&previous.slot===slot)return previous;
 return {version:2,slot,startedAt:now.toISOString(),cursor:null,page:0,records:0,complete:false};
}
async function runBatch(previous,token,{maxPages=7,clock=()=>Date.now()}={}){
 const st=nextCycle(previous,new Date(clock()));
 if(st.complete)return {state:st,unchanged:true};
 const begin=clock();
 for(let i=0;i<maxPages&&clock()-begin<85000;i++){
  const data=await fetchPage(token,st.cursor);
  const records=(data.items||[]).map(normalize).filter(Boolean);
  // Save chunk first. A retry overwrites exactly the same chunk.
  await write(ROOT+"/build/"+st.slot+"/page-"+st.page+".json",records);
  st.records+=records.length;
  st.page++;
  st.cursor=data.has_more?data.page_token:null;
  if(data.has_more&&!st.cursor)throw Error("missing_page_token");
  st.updatedAt=new Date().toISOString();
  await write(STATE,st);
  if(!data.has_more){
   if(st.records<1000)throw Error("snapshot_incomplete_suspicious_row_count");
   const items=[],ids=new Set();
   for(let page=0;page<st.page;page++){
    const segment=await read(ROOT+"/build/"+st.slot+"/page-"+page+".json");
    if(!Array.isArray(segment))throw Error("missing_saved_snapshot_page");
    for(const row of segment){
     if(ids.has(row.gid))throw Error("duplicate_shopify_identity");
     ids.add(row.gid);items.push(row);
    }
   }
   if(items.length!==st.records)throw Error("snapshot_count_mismatch");
   // Publish the new complete snapshot atomically; until now keep last good.
   await write(CURRENT,{version:2,source:"Feishu CRM materialized snapshot",sourceGrading:"2026-11-08 historical CRM writeback; NOT final audited full-history net ledger",slot:st.slot,
    generatedAt:new Date().toISOString(),total:items.length,customers:items});
   st.complete=true;st.completedAt=new Date().toISOString();
   await write(STATE,st);
   break;
  }
 }
 return {state:st,unchanged:false};
}
module.exports=async(req,res)=>{
 res.setHeader("Cache-Control","no-store");
 if(req.method!=="GET")return res.status(405).json({ok:false,error:"method"});
 if(!authorized(req))return res.status(401).json({ok:false,error:"unauthorized"});
 try{
  const baseline=await read("crm-execution/import-cursor.json");
  if(baseline?.shopifyCycleComplete!==true)return res.status(409).json({ok:false,error:"customer_baseline_not_complete"});
  const token=await tenantToken();
  const {state,unchanged}=await runBatch(await read(STATE),token);
  return res.status(200).json({ok:true,unchanged,slot:state.slot,complete:state.complete,
   page:state.page,records:state.records,updatedAt:state.updatedAt||null,
   note:"Indexes existing Feishu CRM records only; does not rescan Shopify history or overwrite CRM."});
 }catch(e){console.error("KBI_INDEX_BUILD",String(e.message||e).slice(0,120));
  return res.status(502).json({ok:false,error:"index_build_failed"});}
};
module.exports.normalize=normalize;
module.exports.nextCycle=nextCycle;
module.exports.slotAt=slotAt;
module.exports.runBatch=runBatch;
module.exports.read=read;
module.exports.ROOT=ROOT;
module.exports.CURRENT=CURRENT;
module.exports.STATE=STATE;
