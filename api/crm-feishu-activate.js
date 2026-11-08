const crypto=require("crypto");
const BASE="https://open.feishu.cn/open-apis";
const SPACE="7705493095961332747";
const HOME="ISzIwGiJQi20Q4kUioGcojmwnWf";
const TITLE="CRM 07｜老道助手与飞书群聊查询指南";
const DOC=[
["h1","Kailash Energy CRM 2.0 · 老道助手"],
["p","团队统一入口｜飞书知识库 × 两张 CRM 业务表 × RFM 模型 × 用户画像与客户旅程"],
["h2","01｜员工如何使用"],
["p","进入已授权的内部 CRM 飞书群，@老道_助手测试，并输入以下命令。机器人只对群内 @ 消息响应；个人客户档案仅在配置的 CRM 内部群开放。"],
["p","CRM帮助：显示可用查询命令、知识库和数据入口。"],
["p","RFM 或 CRM规则：读取最终 CRM 分层标准。B 级阈值为近180天净消费 M>$0，且 R≤180 天、F≥1。"],
["p","CRM旅程：了解潜在客户、首购、复购培养、稳定复购、关系维护、沉睡唤醒的阶段与运营动作。"],
["p","CRM画像：查询客户情感动机、产品图腾偏好、资料来源的证据分级和AI推测边界。"],
["p","客户 customer@example.com：在已授权 CRM 群内读取已同步档案的等级、M/R/F、旅程、画像、偏好、下一次维护日期。"],
["p","CRM进度：查询执行任务状态（注意：部署READY不等于同步数据已完成）。"],
["h2","02｜CRM 数据文件与资料入口"],
["p","CRM中文首页：https://ycnic6l8vkfx.feishu.cn/wiki/ISzIwGiJQi20Q4kUioGcojmwnWf"],
["p","CRM两张现有业务表：https://ycnic6l8vkfx.feishu.cn/wiki/OSUew3QCUics0vkuphJc2sDfnGf"],
["p","客户等级规则：https://ycnic6l8vkfx.feishu.cn/wiki/Rv5uwAt2Cic9RpkskQ9ceqUin6e"],
["p","客户维护与生命周期：https://ycnic6l8vkfx.feishu.cn/wiki/XdVmw67NniPGvEkK3ZWcdIxjnFe"],
["p","用户画像与心理标签：https://ycnic6l8vkfx.feishu.cn/wiki/QujEwg5vriVXhhkpPAyceQYcnsg"],
["h2","03｜客户分层规则（最终确认）"],
["p","M：近180天有效订单净消费；R：距最近有效购买的天数；F：近180天有效订单数。三项同时满足，依照 S+→S→A→B 的顺序取最高等级。"],
["p","S+：M≥$3000，R≤45，F≥5；S：M≥$1500，R≤90，F≥3；A：M≥$800，R≤180，F≥2；B：M>$0，R≤180，F≥1。"],
["p","平均客单价是否≥$400只是独立的消费习惯维度，不影响 S+/S/A/B 评级。资料缺失则显示待核验，不得编造。"],
["h2","04｜用户心理与客户旅程"],
["p","画像记录真实购买、互动及明确表达的偏好；标记为“客户明确表达 / 购买行为证据 / AI推测”。"],
["p","情感意图包括守护、疗愈、纪念与思念、祝福；图腾偏好包括 VAJRA、ZAKIRAM、OM MANI PADME HUM、LOTUS。"],
["p","不从客户姓名、国家、购买图腾推断宗教身份、健康状况及其他敏感属性。"],
["h2","05｜CRM 与客服协作规则"],
["p","客户档案表记录唯一 Shopify 客户ID及CRM级别、RFM、画像、客户旅程；沟通跟进表保存 Gmail 线程、问题类型、待办与处理状态。"],
["p","客服遇到退换、补发赠品、物流异常时，先核对 Shopify 订单与历史沟通，再按照对应 SOP 分工处理。"],
["p","补发赠品须先经 CRM（刘淇）确认，交物流（韵汀）在店小秘处理并截图回复；不得由机器人自行修改订单、发放赠品或对外发送客户邮件。"],
["h2","06｜数据权限与系统状态"],
["p","客户档案信息只允许在授权CRM内部群内查询；飞书文档和多维表格是否能打开，仍取决于飞书本身的文档权限。"],
["p","当前已有两张业务表的字段与部分基础视图，但历史客户和 Gmail 沟通的全量同步、最终仪表盘与提醒自动化须完成验收；空记录不代表真实客户。"],
["p","系统查询状态：https://kailash-energy-ai-knowledge-hub.vercel.app/api/crm-status"]
];
const bodyBlock=([kind,content])=>{
 const key=kind==="h1"?"heading1":kind==="h2"?"heading2":"text";
 const type=kind==="h1"?3:kind==="h2"?4:2;
 return {block_type:type,[key]:{elements:[{text_run:{content}}]}};
};
async function api(token,path,method="GET",data){
 const r=await fetch(BASE+path,{method,headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},...(data?{body:JSON.stringify(data)}:{})});
 const j=await r.json().catch(()=>({}));
 if(!r.ok||j.code!==0)throw new Error((j.msg||r.statusText)+" ["+path+"]");
 return j.data||j;
}
function secureEqual(a,b){
 if(!a||!b)return false;const x=Buffer.from(String(a)),y=Buffer.from(String(b));return x.length===y.length&&crypto.timingSafeEqual(x,y);
}
module.exports=async(req,res)=>{
 res.setHeader("Cache-Control","no-store");
 if(req.method!=="GET")return res.status(405).json({ok:false});
 if(!secureEqual(req.query?.token,process.env.CRM_FEISHU_SETUP_TOKEN))return res.status(401).json({ok:false});
 try{
  const auth=await fetch(BASE+"/auth/v3/tenant_access_token/internal",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({app_id:process.env.FEISHU_APP_ID,app_secret:process.env.FEISHU_APP_SECRET})});
  const x=await auth.json();
  if(!auth.ok||x.code!==0||!x.tenant_access_token)throw new Error("App authentication failed");
  const token=x.tenant_access_token;
  const nodes=await api(token,"/wiki/v2/spaces/"+SPACE+"/nodes?parent_node_token="+HOME+"&page_size=50");
  let node=(nodes.items||[]).find(x=>x.title===TITLE);
  let created=false;
  if(!node){
   const made=await api(token,"/wiki/v2/spaces/"+SPACE+"/nodes","POST",{obj_type:"docx",node_type:"origin",parent_node_token:HOME,title:TITLE});
   node=made.node||made;created=true;
  }
  const doc=node.obj_token;if(!doc)throw new Error("Document object missing");
  const path="/docx/v1/documents/"+doc+"/blocks/"+doc+"/children";
  const existing=await api(token,path+"?page_size=100");
  const lines=new Set((existing.items||[]).flatMap(b=>Object.values({text:b.text,heading1:b.heading1,heading2:b.heading2}).flatMap(x=>(x?.elements||[]).map(y=>y.text_run?.content))).filter(Boolean));
  const missing=DOC.filter(([kind,content])=>!lines.has(content));
  for(let i=0;i<missing.length;i+=18)await api(token,path,"POST",{children:missing.slice(i,i+18).map(bodyBlock)});
  const url="https://ycnic6l8vkfx.feishu.cn/wiki/"+node.node_token;
  const welcome="【Kailash Energy CRM 2.0｜老道助手已接入】\n团队在本群 @老道_助手测试，可以使用：\n· CRM帮助：查看命令\n· RFM：查看正式 S+/S/A/B 模型（B 级 M>$0）\n· CRM旅程：查看客户生命周期\n· CRM画像：查看用户心理与偏好规范\n· 客户 客户邮箱：查询飞书已同步的客户档案\n· CRM进度：查看执行中枢\n\n团队SOP："+url+"\n客户数据遵守飞书权限；尚未同步的历史客户不作虚假返回。";
  let group={configured:!!process.env.FEISHU_CHAT_ID,linked:false,announced:false};
  if(group.configured){
   const info=await api(token,"/im/v1/chats/"+encodeURIComponent(process.env.FEISHU_CHAT_ID));
   const chat=info.chat||info;
   group.chat_mode=chat.chat_mode||null;
   if(chat.chat_mode==="group"){
    group.linked=true;
    const sent=await api(token,"/im/v1/messages?receive_id_type=chat_id","POST",{receive_id:process.env.FEISHU_CHAT_ID,msg_type:"text",content:JSON.stringify({text:welcome})});
    group.announced=!!sent.message_id||!!sent.data?.message_id;
   }
  }
  return res.status(200).json({ok:true,created,new_blocks:missing.length,doc_url:url,group});
 }catch(e){return res.status(502).json({ok:false,error:String(e.message).slice(0,400)})}
};
