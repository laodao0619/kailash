const crypto=require("crypto");
const API="https://open.feishu.cn/open-apis",SPACE="7705493095961332747",HOME="ISzIwGiJQi20Q4kUioGcojmwnWf",TITLE="CRM 08｜经营数据基线与仪表盘建设进度";
const SNAP=[
 ["h1","CRM 经营数据基线｜Shopify 近180天"],
 ["q","数据日期：2026-11-08｜来源：ShopifyQL 实际查询。以下是单次核验快照，不是已完成的飞书实时仪表盘。"],
 ["h2","一｜客户价值指标 · Customer Value"],
 ["p","近180天订单数：2,274"],
 ["p","近180天净销售额：$525,895.23 USD"],
 ["p","平均订单金额（ShopifyQL）：$234.69 USD"],
 ["p","有交易的客户：1,654；回头客户：470；返回客户率：28.42%。"],
 ["q","解释：有交易客户1,654不等于Shopify所有历史客户数量，也不等于飞书已导入的客户记录数。"],
 ["h2","二｜销售趋势（ShopifyQL 月度快照）"],
 ["p","2026-05：153单；净销售额 $35,767.90；新客71；回头客68"],
 ["p","2026-06：209单；净销售额 $51,123.14；新客107；回头客75"],
 ["p","2026-07：512单；净销售额 $117,413.33；新客347；回头客125"],
 ["p","2026-08：562单；净销售额 $125,109.81；新客386；回头客131"],
 ["p","2026-09：472单；净销售额 $109,238.07；新客293；回头客137"],
 ["p","2026-10：300单；净销售额 $72,170.55；新客184；回头客91"],
 ["p","2026-11（截至11月8日）：66单；净销售额 $15,072.43；新客40；回头客25"],
 ["q","注意：5月和11月为近180天窗口中的不完整月份；月度新客与回头客合计不代表180天唯一客户总数。"],
 ["h2","三｜客户维护与关系健康仪表盘 · Customer Care"],
 ["p","当前CRM客户档案尚未导入历史客户，无法计算真实的S+/S/A/B客户数量、未联系客户、维护完成率与客户健康风险；不展示虚假0值。",
 ],
 ["p","应包括：CRM等级×关系健康矩阵、各负责人维护数、逾期维护、S+触达覆盖率、沉睡唤醒与下一步行动。"],
 ["h2","四｜客服效率仪表盘 · Service Efficiency"],
 ["p","Gmail沟通与跟进历史记录尚未导入，无法计算真实首次响应时间、平均解决时间、投诉数量或客服处理效率。"],
 ["p","应包括：每日新工单、待处理、高优先级、等待物流、逾期任务、首次响应时间、处理时长与问题类别结构。"],
 ["h2","五｜自动提醒与数据完整性"],
 ["p","已部署北京时间09:30和16:30飞书群报告程序，任务到期、逾期和关系风险为事件触发；没有真实导入数据时自动跳过，避免发送假报表。"],
 ["p","飞书原生仪表盘数量仍为0；接口目前可读取/复制仪表盘，三个原生图表页面尚待通过飞书前台配置并验收。"],
 ["p","当前系统：客户档案和沟通跟进两张表各有5条空白占位，不应计为正式客户或有效工单。"],
 ["h2","六｜操作入口"],
 ["p","CRM首页：https://ycnic6l8vkfx.feishu.cn/wiki/ISzIwGiJQi20Q4kUioGcojmwnWf"],
 ["p","CRM两张业务表：https://ycnic6l8vkfx.feishu.cn/wiki/OSUew3QCUics0vkuphJc2sDfnGf"],
 ["p","状态检查：https://kailash-energy-ai-knowledge-hub.vercel.app/api/crm-status"]
];
const map={h1:[3,"heading1"],h2:[4,"heading2"],p:[2,"text"],q:[15,"quote"]};
function block([kind,content]){const [block_type,key]=map[kind];return {block_type,[key]:{elements:[{text_run:{content}}]}};}
function match(a,b){if(!a||!b)return false;const x=Buffer.from(String(a)),y=Buffer.from(String(b));return x.length===y.length&&crypto.timingSafeEqual(x,y);}
async function call(t,path,method="GET",payload){
 const r=await fetch(API+path,{method,headers:{Authorization:"Bearer "+t,"Content-Type":"application/json"},...(payload?{body:JSON.stringify(payload)}:{})});
 const j=await r.json().catch(()=>({}));if(!r.ok||j.code!==0)throw Error((j.msg||r.statusText)+" ["+path+"]");return j.data||j;
}
module.exports=async(req,res)=>{
 res.setHeader("Cache-Control","no-store");
 if(req.method!=="GET")return res.status(405).json({ok:false});
 if(!match(req.query?.token,process.env.CRM_SNAPSHOT_TOKEN))return res.status(401).json({ok:false});
 try{
 const a=await fetch(API+"/auth/v3/tenant_access_token/internal",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({app_id:process.env.FEISHU_APP_ID,app_secret:process.env.FEISHU_APP_SECRET})});
 const j=await a.json();if(!a.ok||j.code!==0||!j.tenant_access_token)throw Error("Feishu auth failed");const t=j.tenant_access_token;
 const list=await call(t,"/wiki/v2/spaces/"+SPACE+"/nodes?parent_node_token="+HOME+"&page_size=50");
 let node=(list.items||[]).find(x=>x.title===TITLE);
 if(!node){const out=await call(t,"/wiki/v2/spaces/"+SPACE+"/nodes","POST",{obj_type:"docx",node_type:"origin",parent_node_token:HOME,title:TITLE});node=out.node||out;}
 const doc=node.obj_token,path="/docx/v1/documents/"+doc+"/blocks/"+doc+"/children";
 const old=await call(t,path+"?page_size=100");
 const oldLines=new Set((old.items||[]).flatMap(b=>[b.text,b.heading1,b.heading2,b.quote].flatMap(x=>(x?.elements||[]).map(e=>e.text_run?.content))).filter(Boolean));
 const missing=SNAP.filter(x=>!oldLines.has(x[1]));
 for(let i=0;i<missing.length;i+=15)await call(t,path,"POST",{children:missing.slice(i,i+15).map(block)});
 return res.status(200).json({ok:true,new_blocks:missing.length,total:SNAP.length,url:"https://ycnic6l8vkfx.feishu.cn/wiki/"+node.node_token});
 }catch(e){return res.status(502).json({ok:false,error:String(e.message).slice(0,300)});}
};