// Internal Feishu CRM assistant: no direct public HTTP export of customer records.
const API = "https://open.feishu.cn/open-apis";
const BASE = "Y7VvbgreAasoLtsYdhrcmmDUn5d";
const MASTER = "tblbk7Ju6fcM1BXF";
const CONTACTS = "tblNi7C5q5FYlG06";
const HOME = "https://ycnic6l8vkfx.feishu.cn/wiki/ISzIwGiJQi20Q4kUioGcojmwnWf";
const BASE_URL = "https://ycnic6l8vkfx.feishu.cn/wiki/OSUew3QCUics0vkuphJc2sDfnGf";
const HELP = [
  "【Kailash CRM 2.0｜老道助手】",
  "在已授权 CRM 群 @我，使用以下命令：",
  "CRM帮助：查看查询入口和操作方式",
  "CRM规则 / RFM：查看 S+/S/A/B 评级条件",
  "CRM旅程：查看客户生命周期与维护策略",
  "CRM画像：查看心理与动机标签的证据口径",
  "CRM订阅：查看客户有效性与已订阅、非订阅划分规则",
  "客户 邮箱：查询已同步的客户档案、等级、RFM、旅程与画像摘要",
  "CRM进度：查看执行进度入口",
  "未同步的客户不会编造结果；群外不会提供客户个人信息。",
  "CRM首页：" + HOME,
  "业务数据：" + BASE_URL
].join("\n");
function stringify(field) {
 if (field == null) return "";
 if (typeof field === "number" || typeof field === "boolean") return String(field);
 if (typeof field === "string") return field;
 if (Array.isArray(field)) return field.map(stringify).filter(Boolean).join("、");
 if (typeof field === "object") {
  if (field.text) return field.text;
  if (field.name) return field.name;
  if (field.value != null) return stringify(field.value);
  if (field.link) return field.link;
 }
 return "";
}
async function tenantToken() {
 const r = await fetch(API+"/auth/v3/tenant_access_token/internal",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({app_id:process.env.FEISHU_APP_ID,app_secret:process.env.FEISHU_APP_SECRET})});
 const x=await r.json(); if(!r.ok||x.code!==0||!x.tenant_access_token)throw new Error("Feishu authentication failed");
 return x.tenant_access_token;
}
async function searchField(token,table,field,value) {
 const url=API+"/bitable/v1/apps/"+BASE+"/tables/"+table+"/records/search?page_size=10";
 const r=await fetch(url,{method:"POST",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},body:JSON.stringify({filter:{conjunction:"and",conditions:[{field_name:field,operator:"is",value:[value]}]}})});
 const j=await r.json();
 if(!r.ok||j.code!==0)throw new Error("CRM lookup failed: "+(j.msg||r.status));
 return j.data?.items||[];
}
function fmtMoney(s) {
 const raw=stringify(s).trim(); if(!raw)return "待核验"; const n=Number(raw);return Number.isFinite(n)?"$"+n.toLocaleString("en-US",{maximumFractionDigits:2}):"待核验";
}
function plainRules(){
 return [
  "【CRM等级｜最终规则】",
  "等级按历史累计消费（不限时间，USD）及近180天有效订单数判断。",
  "S+｜专属服务客户：历史累计≥$3,000，近180天≥1单。",
  "S｜重点客户：历史累计$1,500–<$3,000，近180天≥1单。",
  "A｜成长客户：历史累计$800–<$1,500，近180天≥1单。",
  "B｜基础客户：历史累计>$0–<$800，近180天≥1单。",
  "沉睡客户：历史累计>$0，近180天0单；从未购买单独归类。",
  "行为RFM：M为近180天净消费，R为距最近有效购买天数，F为近180天订单数，独立于等级。",
  "平均客单价$400只用于高/低客单价分组，不参与等级。",
  "数据不完整标记待核验，绝不能仅凭历史累计消费判断等级。",
  "详细SOP："+HOME
 ].join("\n");
}
function lifecycle() {
 return [
 "【CRM客户旅程与维护】",
 "潜在客户 → 首购 → 复购培养 → 稳定复购 → 关系维护 → 沉睡唤醒。",
 "S+：专人一对一维护，邀请WhatsApp（尊重客户授权）；不因近期消费下降而自动移除既定服务。",
 "S/A：围绕历史购买、手工艺偏好和合适新品提供服务，结合投诉状态和互动记录安排跟进。",
 "B：优先完善首购体验、物流关怀、护理和关联产品推荐。",
 "60/120天观察未复购客户；180天后按有效订单重新判定沉睡。",
 "触达前查营销授权、上次联系、投诉和频控；系统仅建议下一步行动，不自动发送。",
 "档案入口："+BASE_URL
 ].join("\n");
}
function psychology() {
 return [
 "【用户心理与画像｜证据优先】",
 "情感意图：守护Protection、疗愈Healing、纪念Remembrance、祝福Blessings；仅在客户表达或已购买/互动证据支持时标注。",
 "图腾主题：VAJRA勇气守护、ZAKIRAM财富事业、OM MANI PADME HUM慈悲净化、LOTUS觉醒洞见。",
 "画像结论须标注证据来源：客户明确表达 / 可核验购买行为 / AI推测；推测不能当作事实。",
 "不推断客户的宗教身份、医疗状况、敏感个人信息或心理诊断。",
 "推荐动作结合实际订单、偏好、客诉及客户旅程，需人工确认。",
 "知识库："+HOME
 ].join("\n");
}
function subscriptionRules(){
 return [
 "【CRM客户有效性与订阅状态】",
 "Shopify Customers 为唯一来源；使用 defaultEmailAddress.marketingState，不通过购买金额推断订阅。",
 "已订阅：SUBSCRIBED；非订阅：NOT_SUBSCRIBED、UNSUBSCRIBED、PENDING（分别保留原始含义）。",
 "QQ、机器人、虚假/临时邮箱、测试账号和无订阅无订单的匿名资料不进入正式 CRM。",
 "可疑的已购客户不被当作没有订单，保留排除数量供人工审核；不删除 Shopify 源数据。",
 "CRM客户档案中的 邮件订阅状态、客户数据状态 才是团队分组依据。",
 "详情："+BASE_URL
 ].join("\n");
}
function mask(email){const p=email.split("@");if(p.length!==2)return "已隐藏";return p[0].slice(0,2)+"***@"+p[1];}
async function customer(token,term){
 const email=term.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[A-Za-z]{2,}/)?.[0]?.toLowerCase();
 const gid=term.match(/(?:gid:\/\/shopify\/Customer\/)?(\d{8,20})/)?.[1];
 if(!email&&!gid)return "请使用准确客户邮箱或Shopify客户ID查询。例如：客户 example@domain.com。为了保护隐私，仅在已授权CRM群中返回客户信息。";
 let records = email?await searchField(token,MASTER,"邮箱",email):await searchField(token,MASTER,"Shopify客户ID","gid://shopify/Customer/"+gid);
 if(!records.length&&gid)records=await searchField(token,MASTER,"Shopify客户ID",gid);
 if(!records.length)return "没有找到已同步的客户档案。当前飞书CRM历史客户数据仍需同步，不能据此判断Shopify没有这个客户。\n客户文件："+BASE_URL;
 if(records.length>1)return "发现多个匹配记录，已暂停自动合并。请CRM负责人检查Shopify客户ID。";
 const f=records[0].fields||{};
 const show=(key,alternative="尚未记录")=>stringify(f[key])||alternative;
 return [
 "【CRM客户档案｜飞书实时查询】",
 "姓名："+show("客户姓名"),"邮箱："+(email?mask(email):"已隐藏"),
 "Shopify ID："+show("Shopify客户ID"),
 "CRM等级（新规则，财务待核验）："+require("../lib/crm-tier-policy").fromFields(f).tier,
 "邮件订阅："+show("邮件订阅状态","待同步"),
 "数据质量："+show("客户数据状态","待核验"),
 "M（180天净消费）："+fmtMoney(f["近180天净消费"]),
 "R（距最近购买天数）："+show("最近购买距今天数R","待计算"),
 "F（180天订单）："+show("近180天有效订单数","待计算"),
 "历史订单："+show("历史订单数","未同步"),
 "客户旅程："+show("客户旅程阶段"),
 "RFM分群："+show("RFM价值分群"),
 "用户画像："+show("用户画像摘要","暂无证据"),
 "购买动机："+show("用户心理与购买动机","暂无可靠证据"),
 "主题偏好："+show("偏好主题与图腾","未记录"),
 "下一次维护："+show("建议下一次维护日期","未安排"),
 "推荐动作："+show("推荐维护动作","待CRM负责人判断"),
 "所有数据来源：飞书档案，仅供内部运营；若数据未同步请核对Shopify。",
 "业务链接："+BASE_URL
 ].join("\n");
}
async function progress(){
 const r=await fetch("https://kailash-energy-ai-knowledge-hub.vercel.app/api/crm-status");
 if(!r.ok)return "执行状态暂时不可用。入口：https://kailash-energy-ai-knowledge-hub.vercel.app/api/crm-status";
 const j=await r.json();
 return "【CRM执行进度】\n"+(j.tasks||[]).map(t=>t.id+"："+({done:"完成",in_progress:"进行中",queued:"排队",retry:"待重试"}[t.status]||t.status)).join("；")+"\n最新更新："+(j.updated_at||"未知");
}
async function answer(text,context={}){
 const s=String(text||"").replace(/@_user_\d+/g,"").replace(/^\s*\/crm\s*/i,"CRM ").trim();
 if(!s)return HELP;
 const authorizedGroup=!!context.chatId && String(context.chatId)===String(process.env.FEISHU_CHAT_ID||"") && context.chatType!=="p2p";
 if(/客户\s*\S+@|客户\s+(?:gid|\d{8,20})/i.test(s)){
  if(!authorizedGroup)return "客户个人资料只能在指定的内部CRM群中查询。请在授权群@老道_助手测试，或者打开飞书客户档案。\n"+BASE_URL;
  const token=await tenantToken();
  return customer(token,s);
 }
 if(/(CRM帮助|帮助|菜单|功能)/i.test(s))return HELP;
 if(/(RFM|CRM规则|客户分层|评级)/i.test(s))return plainRules();
 if(/(CRM画像|用户心理|购买动机|情感需求)/i.test(s))return psychology();
 if(/(CRM订阅|订阅状态|有效客户|客户有效性)/i.test(s))return subscriptionRules();
 if(/(CRM旅程|生命周期|客户旅程|维护策略)/i.test(s))return lifecycle();
 if(/(CRM进度|项目进度|任务进度)/i.test(s))return progress();
 if(/(CRM|客户档案|客户维护|客户)/i.test(s))return HELP;
 return null; // Existing assistant retains regular OpenAI chat.
}
module.exports={answer,HELP};
