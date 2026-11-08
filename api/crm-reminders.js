const crypto=require("crypto");
const API="https://open.feishu.cn/open-apis";
const BASE="Y7VvbgreAasoLtsYdhrcmmDUn5d";
const MASTER="tblbk7Ju6fcM1BXF", TASKS="tblNi7C5q5FYlG06";
function auth(req){
 const expected=process.env.CRON_SECRET, supplied=(req.headers.authorization||"").replace(/^Bearer\s+/i,"");
 if(!expected)return false;const a=Buffer.from(supplied),b=Buffer.from(expected);
 return a.length===b.length&&crypto.timingSafeEqual(a,b);
}
async function tenant(){
 const r=await fetch(API+"/auth/v3/tenant_access_token/internal",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({app_id:process.env.FEISHU_APP_ID,app_secret:process.env.FEISHU_APP_SECRET})});
 const j=await r.json();if(!r.ok||j.code!==0||!j.tenant_access_token)throw Error("Feishu tenant auth failed");return j.tenant_access_token;
}
async function records(t,id){
 const output=[];let page_token;
 for(let i=0;i<10;i++){
  const url=new URL(API+"/bitable/v1/apps/"+BASE+"/tables/"+id+"/records");
  url.searchParams.set("page_size","500");if(page_token)url.searchParams.set("page_token",page_token);
  const r=await fetch(url,{headers:{Authorization:"Bearer "+t}});
  const j=await r.json();
  if(!r.ok||j.code!==0)throw Error("Bitable data read failed");
  output.push(...(j.data?.items||[]));
  if(!j.data?.has_more||!j.data?.page_token)break;
  page_token=j.data.page_token;
 }
 return output;
}
function raw(v){
 if(v==null)return "";
 if(Array.isArray(v))return v.map(raw).join(" ");
 if(typeof v==="object")return v.text||v.name||v.value||"";
 return String(v);
}
function day(v){
 if(v==null||v==="")return null;
 const n=Number(v);
 const d=Number.isFinite(n)&&n>100000000?new Date(n):new Date(v);
 return Number.isFinite(d.getTime())?d:null;
}
function uuid(seed){
 const bytes=crypto.createHash("sha256").update(seed).digest().subarray(0,16);
 bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
 const h=bytes.toString("hex");
 return h.slice(0,8)+"-"+h.slice(8,12)+"-"+h.slice(12,16)+"-"+h.slice(16,20)+"-"+h.slice(20,32);
}
async function send(t,chat,text,id){
 const r=await fetch(API+"/im/v1/messages?receive_id_type=chat_id",{
  method:"POST",headers:{Authorization:"Bearer "+t,"Content-Type":"application/json"},
  body:JSON.stringify({receive_id:chat,msg_type:"text",content:JSON.stringify({text}),uuid:id})
 });
 const j=await r.json();
 if(!r.ok||j.code!==0)throw Error("Feishu group delivery failed: "+(j.code||r.status));
 return !!j.data?.message_id;
}
module.exports=async(req,res)=>{
 res.setHeader("Cache-Control","no-store");
 if(req.method!=="GET")return res.status(405).json({ok:false,error:"method"});
 if(!auth(req))return res.status(401).json({ok:false,error:"auth"});
 if(!process.env.FEISHU_CHAT_ID||!process.env.FEISHU_APP_ID||!process.env.FEISHU_APP_SECRET)
  return res.status(200).json({ok:true,skipped:"report_gateway_only"});
 const now=new Date();const utcH=now.getUTCHours();
 if(utcH!==1&&utcH!==8)return res.status(200).json({ok:true,skipped:"outside_schedule"});
 const shift=utcH===1?"09:30 晨报":"16:30 执行汇总";
 const shanghai=now.toLocaleDateString("en-CA",{timeZone:"Asia/Shanghai"});
 try{
  const t=await tenant();
  const [clients,followups]=await Promise.all([records(t,MASTER),records(t,TASKS)]);
  const meaningfulCustomers=clients.filter(x=>raw(x.fields?.["Shopify客户ID"])||raw(x.fields?.["邮箱"]));
  const realTasks=followups.filter(x=>raw(x.fields?.["沟通记录编号"])||raw(x.fields?.["数据来源ID"]));
  const stats={customers:meaningfulCustomers.length,followups:realTasks.length,due:0,overdue:0,risk:0,splus:0};
  const today=Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate());
  for(const r of meaningfulCustomers){
   const f=r.fields||{};
   if(raw(f["CRM等级"])==="S+")stats.splus++;
   if(raw(f["客户状态"])==="风险")stats.risk++;
   const d=day(f["建议下一次维护日期"]);
   if(d&&d.getTime()<=today+86400000)stats.due++;
  }
  for(const r of realTasks){
   const f=r.fields||{},status=raw(f["任务状态"]);
   if(["已完成","已取消"].includes(status))continue;
   const d=day(f["截止日期"]);
   if(d&&d.getTime()<today)stats.overdue++;
   if(d&&d.getTime()<today+86400000)stats.due++;
  }
  if(!meaningfulCustomers.length&&!realTasks.length){
   return res.status(200).json({ok:true,skipped:"no_imported_customer_or_task_records",stats});
  }
  if(!stats.due&&!stats.overdue&&!stats.risk&&shift.startsWith("16:30")){
   return res.status(200).json({ok:true,skipped:"nothing_actionable",stats});
  }
  const message=[
   "Kailash Energy CRM 2.0｜"+shift,
   "日期："+shanghai+"（北京时间）",
   "已同步客户："+stats.customers+"；已建工单："+stats.followups,
   "S+客户："+stats.splus+"；关系风险："+stats.risk,
   "今日到期/需维护："+stats.due+"；逾期工单："+stats.overdue,
   "具体名单请进入对应飞书视图，由负责人根据客户授权与历史沟通安排处理。",
   "CRM工作台：https://ycnic6l8vkfx.feishu.cn/wiki/OSUew3QCUics0vkuphJc2sDfnGf"
  ].join("\n");
  const sent=await send(t,process.env.FEISHU_CHAT_ID,message,uuid(shanghai+shift));
  return res.status(200).json({ok:true,sent,shift,stats});
 }catch(e){return res.status(502).json({ok:false,error:String(e.message).slice(0,180)});}
};