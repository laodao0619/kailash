const API="https://open.feishu.cn/open-apis";
const SPACE="7705493095961332747", HOME="ISzIwGiJQi20Q4kUioGcojmwnWf";
const DOCS={
  grading:{title:"CRM 01｜客户分层与 RFM 数据口径",lines:[
    "KAILASH ENERGY · CRM 2.0｜客户分层与 RFM 数据口径",
    "用途：统一 Shopify 订单口径、CRM 等级和 RFM 分群；所有分层都需要有可核验的数据来源。",
    "M：最近180天累计有效订单净消费额（美元），剔除退款、取消与测试订单。R：距最近有效购买的天数。F：最近180天有效订单数量。",
    "判级顺序：S+ → S → A → B，依次判断。客户必须同时满足等级下的 M、R、F 三项条件，取满足条件的最高等级，禁止只按历史总消费判级。",
    "S+：M≥$3,000 且 R≤45天 且 F≥5单。",
    "S：M≥$1,500 且 R≤90天 且 F≥3单。",
    "A：M≥$800 且 R≤180天 且 F≥2单。",
    "B：M>$0 且 R≤180天 且 F≥1单。",
    "基础客户：近180天有购买但未同时满足B级全部条件；保留基础客户状态，不擅自提升至B。",
    "沉睡客户：曾购买且距最近一次有效购买已超过180天。未购买客户：历史有效订单为0。",
    "客单价分组：以$400为界划分高/低客单价群体；此维度不改变CRM等级判定标准。",
    "历史累计消费与最近180天净消费必须分字段保存，不能混用。",
    "缺少最近180天订单明细或退款信息时，标记“待核验”，不可用历史消费推算等级。",
    "更新频率：Shopify订单新增、退款、取消时增量更新；建议每日重新计算一次R、M、F。",
    "数据主源：Shopify订单及客户记录；飞书仅保存业务运营衍生字段与审核结果。"
  ]},
  schema:{title:"CRM 02｜数据来源、字段及系统映射",lines:[
    "CRM 2.0｜数据来源与字段映射",
    "CRM 仅复用现有两张业务表，禁止另建第三张客户业务表。产品资产库与本CRM隔离。",
    "客户档案表：tblbk7Ju6fcM1BXF。沟通与跟进表：tblNi7C5q5FYlG06。飞书多维表格应用：Y7VvbgreAasoLtsYdhrcmmDUn5d。",
    "客户档案主键：Shopify客户ID；同时保留邮箱作为辅助识别，不能只凭同名合并客户。订单金额以USD为主要分析币种。",
    "Shopify → 客户姓名、邮箱、国家/地区、客户ID、近180天有效订单次数与净消费、历史订单数、最近有效下单时间。",
    "Gmail → 线程ID、收件人/发件人、时间、主题、沟通摘要、客户意图、情绪、处理结果、原邮件链接。",
    "飞书 → 负责人、客户等级、生命周期、关系健康、跟进截止时间、优先级、人工结论与客户维护记录。",
    "关键同步规则：使用Shopify客户ID及Gmail线程ID/消息ID去重，采用幂等写入；重复抓取不得生成重复客户或重复跟进。",
    "数据质量：金额、订单状态、时间和订单号来源必须可追溯；未能匹配Shopify客户的邮件应进入待匹配队列。",
    "保护规则：不自动发送邮件、不自动退款、不自动改订单、不删除历史客户记录、不擅自修改产品资产库。",
    "飞书客户价值分析：CRM等级、RFM、消费贡献与沉睡风险。维护看板：负责人、状态、截止日期与下一步动作。",
    "飞书沟通档案：Gmail原始线程为来源，飞书保存摘要与处理状态；资料过期时重新查询来源。",
    "客户隐私：只存满足运营用途的必要信息；避免在公开日志中记录邮箱、电话、地址、订单详情或邮件原文。",
    "CRM状态接口：https://kailash-energy-ai-knowledge-hub.vercel.app/api/crm-status",
    "飞书已有CRM多维表格：https://ycnic6l8vkfx.feishu.cn/wiki/OSUew3QCUics0vkuphJc2sDfnGf"
  ]},
  service:{title:"CRM 03｜客服、售后与补发 SOP",lines:[
    "KAILASH ENERGY｜客服与售后 SOP",
    "执行原则：尊重客户意愿；沟通记录可追溯；人工审批涉及退款、订单调整与赠品发放。",
    "售后统一说明：常规配送约10–20天。订单低于$150时标准运费$18。收到产品7天内支持按政策退货；30天保修（具体适用条件以当时网站政策为准）。",
    "初次咨询：记录客户姓名、邮箱、订单号、咨询主题、当前状态和负责人。",
    "物流问题：核实Shopify履约与实际追踪状态，区分运输中、延误、未揽收、地址异常和丢件，不猜测快递时间。",
    "产品问题：确认款式、材料、订单号、图片证据；依据维修/退货政策给出人工处理方案。",
    "客户补发包裹或加赠品：CRM负责人刘淇先与客户确认，再在飞书客服群发送订单号、收件人、要赠送的产品以及必要说明给物流负责人韵汀。",
    "物流负责人操作分两类：（1）在原订单增加赠品；（2）在店小秘新建补发订单。所有赠品都必须在店小秘中体现。",
    "韵汀操作完成后引用前一条消息并附截图，确认订单需求已在店小秘备注；由CRM复核并更新飞书处理状态。",
    "客服沟通状态建议：待处理、处理中、等待客户、已完成、已取消。",
    "问题优先级：紧急（影响支付、安全或重大投诉）、高（临近承诺期限或重要售后）、普通、低。",
    "发货关怀：提醒珠宝护理及产品仪式信息，不夸大功效。",
    "升级规则：超过承诺时限、无法核实订单、客户明确不满或高价值客户重大问题，应指派负责人并设截止时间。",
    "记录追溯：Gmail线程、Shopify订单和店小秘订单间保留相互关联，防止再次联系时信息断裂。"
  ]},
  care:{title:"CRM 04｜客户维护、生命周期与 WhatsApp",lines:[
    "KAILASH ENERGY｜客户维护与生命周期",
    "维护目标：保持长久客户关系，优先关注高价值与风险客户；避免无理由的频繁营销打扰。",
    "S+客户：无论最近购买何时，原则上由专人邀请添加WhatsApp进行一对一服务；沟通基于授权与客户意愿。",
    "S客户：重点提供购买后关怀、个性化推荐和仪式服务介绍，查看最近互动与复购机会。",
    "A客户：结合已购产品主题推荐相关新品与品牌故事，减少无差别折扣。",
    "B客户：以首次购买体验、护理指导、品牌故事及下一次适配推荐为核心。",
    "近60天未复购：结合已购产品推荐新品和热销产品，保持温和语气。",
    "近120天未复购：提供更有针对性的回访与重新连接，先判断是否有售后问题。",
    "沉睡客户：优先核实最近的联系、订单和生命周期，不把所有沉睡客户视作优惠券人群。",
    "客户旅程：潜在客户 → 首次购买 → 复购培养 → 稳定复购 → 关系维护 → 沉睡唤醒。",
    "维护记录核心字段：负责人、上次联系日期、下一次日期、客户诉求、处理状态、推荐动作、关系风险。",
    "下一步最佳行动（NBA）：根据真实购买偏好、近期售后、客户意图和当前风险生成建议；只作为人工决策参考。",
    "运营节奏参考：45/60/90/120/180天分层观察，结合最近一次真实购买和联系情况，而不是机械批量触发。",
    "不应自行向客户发送WhatsApp、邮件、退款承诺或优惠，除非已有明确营销授权与运营规则。",
    "报告看板：高价值客户覆盖率、待办完成率、超期数量、近180天复购率、客户沟通闭环率。"
  ]},
  insight:{title:"CRM 05｜用户画像与心理标签规范",lines:[
    "KAILASH ENERGY｜客户画像与心理标签",
    "核心客群：以欧美35–65+消费者为主，关注西藏文化、传统手工艺、情感寄托和有意义的礼赠。",
    "四类主要情感意图：守护（Protection）、疗愈与内在平静（Healing）、纪念与思念（Remembrance）、祝福与鼓励（Blessings）。",
    "图腾偏好：ZAKIRAM 财富与事业；VAJRA 勇气与保护；OM MANI PADME HUM 疗愈、慈悲与净化；LOTUS 洞见与觉醒。",
    "画像标签分为“客户明确表达”“购买/浏览行为可证”“AI推测”；推测不得当作客户本人陈述。",
    "推荐字段：偏好主题与图腾、历史购买材料、礼赠对象、收藏兴趣、价格偏好、内容互动、是否偏好仪式。",
    "AI摘要格式：事实/来源/日期/推测/置信程度/推荐动作；避免虚构客户身份、信仰、健康状态或精神状况。",
    "客户情绪标签是沟通情境的临时判断，不代表客户永久性格；重要投诉需人工确认。",
    "不得通过姓名、居住地、语言或购买图腾推断宗教归属、族裔、医疗问题等敏感属性。",
    "内容语言：避免硬销；强调真实手工、来源、文化语境、祝福对象与具体日常使用方式。",
    "营销匹配：新品和热销作为基础推荐，结合客户之前购买的款式、材质与目的；优先推荐关联产品而非重复同款。",
    "AI辅助任务：将沟通记录转为可追溯摘要、标记风险和下一步行动；所有对外沟通须遵守授权。"
  ]},
  brand:{title:"CRM 06｜品牌主张、仪式与2026品牌月资料",lines:[
    "KAILASH ENERGY｜品牌与仪式知识速查",
    "品牌定位：面向全球市场的西藏文化与喜马拉雅灵性珠宝品牌，强调藏地工匠手作、藏族文化图腾、自然材料与情感意义。",
    "工坊制作：西藏当地手工匠人制作；跨境订单通常经上海中转，常规履约时间约10–20天。",
    "品牌表达：避免把文化符号视为纯装饰；突出手艺、传统与个人愿望。涉及祝福仪式不保证特定财富、健康或人生成效。",
    "仪式流程：藏柏净化、颂钵、个人愿望联结咒和祝福；具体是否包含以产品及活动页面为准。",
    "四大图腾：扎基拉姆 Wealth & Career、金刚杵 Courage & Protection、六字真言 Healing & Purification、莲花 Awakening & Insight。",
    "Everyday Blessings：供灯体验价 $39；108面经幡祈福体验价 $59；Jewelry Blessing 可选 $50（以最新活动页面为准）。",
    "供灯地点范围：Jokhang、Zhire、Zaki 三寺；经幡悬挂地点随月变化，包括神山、圣湖与寺庙。",
    "2026年11月品牌月主题：Kailash Day of Giving；Infinite Light · Compassion · Blessings · Sharing。",
    "2026品牌日活动开始时间：11月16日。文化切入：阿弥陀佛的无量光与慈悲，祝愿不只属于自己，也可以给予亲友。",
    "品牌月商品活动：Buy 2 Get 1 Free，以低价商品免费；买2免1、买3免1、买4免2、买5免2。",
    "活动排除：Antique/Vintage 独一藏品与地毯。优惠适用范围和仪式服务以实时活动页为准。",
    "营销表达：一件给自己，一件送给重要的人；避免以黑五冲动折扣主导全部品牌叙事。",
    "古董文案规范：古董主体与当代新做的银镶嵌必须明确区分，未核定年代、材质纯度时不能擅自宣称。",
    "社媒原则：真实的人文与寺院画面，关注祝福、守护、疗愈与思念；佩戴图保持产品真实款式和比例。"
  ]}
};
async function call(token,path,method="GET",body){
 const response=await fetch(API+path,{method,headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},...(body?{body:JSON.stringify(body)}:{})});
 const data=await response.json().catch(()=>({}));
 if(!response.ok||data.code!==0)throw new Error((data.msg||response.statusText)+" ["+path+"]");
 return data.data||data;
}
module.exports=async(req,res)=>{
 if(req.method!=="POST")return res.status(405).json({ok:false});
 const expected=process.env.REPORT_GATEWAY_TOKEN||"";
 const supplied=(req.headers.authorization||"").replace(/^Bearer\s+/i,"");
 if(!expected||supplied!==expected)return res.status(401).json({ok:false});
 const slug=req.query?.doc;
 if(!DOCS[slug])return res.status(400).json({ok:false,error:"Unknown document"});
 try{
  const auth=await fetch(API+"/auth/v3/tenant_access_token/internal",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({app_id:process.env.FEISHU_APP_ID,app_secret:process.env.FEISHU_APP_SECRET})});
  const a=await auth.json();
  if(!auth.ok||a.code!==0||!a.tenant_access_token)throw new Error("Feishu auth failed");
  const token=a.tenant_access_token, spec=DOCS[slug];
  const list=await call(token,"/wiki/v2/spaces/"+SPACE+"/nodes?page_size=50&parent_node_token="+HOME);
  let node=(list.items||[]).find(n=>n.title===spec.title);
  let created=false;
  if(!node){
   const made=await call(token,"/wiki/v2/spaces/"+SPACE+"/nodes","POST",{obj_type:"docx",node_type:"origin",parent_node_token:HOME,title:spec.title});
   node=made.node||made;created=true;
  }
  const doc=node.obj_token;
  if(!doc)throw new Error("Wiki document token missing");
  const existing=await call(token,"/docx/v1/documents/"+doc+"/blocks/"+doc+"/children?page_size=100");
  const existingLines=new Set((existing.items||[]).flatMap(b=>(b.text?.elements||[]).map(e=>e.text_run?.content)).filter(Boolean));
  const missing=spec.lines.filter(line=>!existingLines.has(line));
  let added=0;
  if(missing.length){
   const blocks=missing.map(line=>({block_type:2,text:{elements:[{text_run:{content:line}}]}}));
   for(let i=0;i<blocks.length;i+=20){
     const chunk=blocks.slice(i,i+20);
     await call(token,"/docx/v1/documents/"+doc+"/blocks/"+doc+"/children","POST",{children:chunk});
     added+=chunk.length;
   }
  }
  return res.status(200).json({ok:true,slug,title:spec.title,created,added,expected:spec.lines.length,node_token:node.node_token,url:"https://ycnic6l8vkfx.feishu.cn/wiki/"+node.node_token});
 }catch(e){return res.status(502).json({ok:false,error:e.message});}
};
