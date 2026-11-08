const API="https://open.feishu.cn/open-apis";
const DOC="JaazdO9lMoTlGrxd3KecqMtRnbb";
const LINES=[
 "CRM 2.0｜已启用业务入口及知识文档（2026-11-08）",
 "客户档案／沟通与跟进 多维表格：https://ycnic6l8vkfx.feishu.cn/wiki/OSUew3QCUics0vkuphJc2sDfnGf",
 "01 客户分层与 RFM：https://ycnic6l8vkfx.feishu.cn/wiki/Rv5uwAt2Cic9RpkskQ9ceqUin6e",
 "02 数据来源及字段：https://ycnic6l8vkfx.feishu.cn/wiki/N2yewN0DRifOQrkncwMc16lOndd",
 "03 客服、售后及补发 SOP：https://ycnic6l8vkfx.feishu.cn/wiki/WJAsw5m20i2P72kYKg3caUmmnLg",
 "04 客户维护与生命周期：https://ycnic6l8vkfx.feishu.cn/wiki/XdVmw67NniPGvEkK3ZWcdIxjnFe",
 "05 用户画像与心理标签：https://ycnic6l8vkfx.feishu.cn/wiki/QujEwg5vriVXhhkpPAyceQYcnsg",
 "06 品牌、仪式与品牌月：https://ycnic6l8vkfx.feishu.cn/wiki/BBj8wInh1ivF4okoyTxc7q4VnV4",
 "CRM 执行状态：https://kailash-energy-ai-knowledge-hub.vercel.app/api/crm-status",
 "提醒：字段与基础视图已建立，筛选分组、客户记录全量同步、仪表盘尚需另外验收。"
];
async function call(token,path,method="GET",body){
 const r=await fetch(API+path,{method,headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},...(body?{body:JSON.stringify(body)}:{})});
 const d=await r.json().catch(()=>({}));if(!r.ok||d.code!==0)throw new Error((d.msg||r.statusText)+" ["+path+"]");
 return d.data||d;
}
module.exports=async(req,res)=>{
 if(req.method!=="POST")return res.status(405).json({ok:false});
 const expected=process.env.REPORT_GATEWAY_TOKEN||"";
 const supplied=(req.headers.authorization||"").replace(/^Bearer\s+/i,"");
 if(!expected||expected!==supplied)return res.status(401).json({ok:false});
 try{
 const r=await fetch(API+"/auth/v3/tenant_access_token/internal",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({app_id:process.env.FEISHU_APP_ID,app_secret:process.env.FEISHU_APP_SECRET})});
 const d=await r.json();if(!r.ok||d.code!==0||!d.tenant_access_token)throw new Error("Feishu authorization failed");
 const token=d.tenant_access_token;
 const base="/docx/v1/documents/"+DOC+"/blocks/"+DOC+"/children";
 const old=await call(token,base+"?page_size=100");
 const existing=new Set((old.items||[]).flatMap(b=>(b.text?.elements||[]).map(e=>e.text_run?.content)).filter(Boolean));
 const missing=LINES.filter(line=>!existing.has(line));
 if(missing.length)await call(token,base,"POST",{children:missing.map(content=>({block_type:2,text:{elements:[{text_run:{content}}]}}))});
 return res.status(200).json({ok:true,home:"https://ycnic6l8vkfx.feishu.cn/wiki/ISzIwGiJQi20Q4kUioGcojmwnWf",added:missing.length,total:LINES.length});
 }catch(e){return res.status(502).json({ok:false,error:e.message})}
};