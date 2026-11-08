const crypto=require("crypto");
const DOCS=require("./crm-knowledge").DOCS;
const API="https://open.feishu.cn/open-apis";
const NODES={
 grading:"Rv5uwAt2Cic9RpkskQ9ceqUin6e",
 schema:"N2yewN0DRifOQrkncwMc16lOndd",
 service:"WJAsw5m20i2P72kYKg3caUmmnLg",
 care:"XdVmw67NniPGvEkK3ZWcdIxjnFe",
 insight:"QujEwg5vriVXhhkpPAyceQYcnsg",
 brand:"BBj8wInh1ivF4okoyTxc7q4VnV4"
};
const LAYOUT={
 grading:[
  {h:"一｜评级的数据口径",ids:[1,2,3]},
  {h:"二｜正式评级条件（S+ → S → A → B）",ids:[4,5,6,7,8,9,10]},
  {h:"三｜边界情况与禁止推断",ids:[11,12,13]},
  {h:"四｜数据刷新与核验",ids:[14]},
  {h:"五｜执行步骤",steps:[
   "Shopify订单按店铺时区落入近180天窗口，排除测试、取消与无效订单；退款需抵减净额。",
   "以Shopify customer ID合并订单，计算M、F以及最近有效下单日至今的R；无明确ID进入待匹配。",
   "按S+、S、A、B逐级判断，三项均符合才赋级；高低客单价$400为独立标签。",
   "写入飞书客户档案并记录计算日期，不覆盖客户备注、人工偏好与负责人。",
   "抽查首购、退款、负净额、跨币种、180天边界和升级/降级案例；异常入待办。"
  ]},
  {h:"六｜报告与验收",steps:[
   "记录统计日、店铺时区、客户覆盖数、订单数及源数据完整性。",
   "按等级统计人数、180天消费贡献、维护覆盖率、沉睡和未购客户，剔除待核验项。",
   "退款及订单取消发生后，下一次同步重新计算等级，保留变更时间与原因。"
  ]}
 ],
 schema:[
  {h:"一｜数据资产与主键",ids:[1,2,3]},
  {h:"二｜系统映射",ids:[4,5,6]},
  {h:"三｜去重与数据质量控制",ids:[7,8,9]},
  {h:"四｜客户档案的字段责任",ids:[10,11]},
  {h:"五｜数据保护与连接入口",ids:[12,13,14]},
  {h:"六｜同步操作 SOP",steps:[
   "首次只读获取Shopify客户、订单和退款资料以及Gmail邮件清单；先检查来源总量与时间窗口。",
   "Shopify customer ID为客户主键，email是辅助匹配；遇到重复、空邮箱和多人共用邮箱走人工核验。",
   "Gmail以message ID防重复，以thread ID关联沟通；回复不等于新客户工单。",
   "将来源数据规范化后upsert飞书两张业务表，日志仅记录数量、hash和执行状态。",
   "遇到接口429/5xx时指数退避重试，连续失败创建异常，不对客户自动执行营销、退款、赠品或订单修改。",
   "完成后对比Shopify客户/订单总量与飞书成功、失败、跳过和待核验人数。"
  ]}
 ],
 service:[
  {h:"一｜服务范围与政策",ids:[1,2]},
  {h:"二｜客户咨询与工单状态",ids:[3,4,5,6]},
  {h:"三｜赠品与补发的确认流程",ids:[7,8,9]},
  {h:"四｜处理升级与回访",ids:[10,11,12,13]},
  {h:"五｜跨部门流程（已确认）",steps:[
   "CRM刘淇与客户核实需求，确认订单号、赠品SKU或产品名称、是否原单加赠及收货信息。",
   "刘淇在飞书客服群发送【订单号／客户／需求／产品／处理方式／备注】给物流负责人韵汀。",
   "韵汀根据情况选择：A在原有订单加赠；B在店小秘新建补发包裹，且所有赠品在店小秘均有明确商品记录。",
   "韵汀完成后引用原消息、附店小秘截图回复；这是“已备注完成”的凭证。",
   "刘淇复核对应订单、赠品和截图并更新工单状态；若需要独立追踪号，物流继续补充。",
   "不能以飞书消息替代店小秘订单记录，也不能仅凭AI回复视为物流已完成。"
  ]},
  {h:"六｜服务质量与记录",steps:[
   "每个客户问题统一记录来源渠道、Gmail线程、订单号、责任人、处理状态、截止日期和下一步动作。",
   "重大投诉、支付争议、重复追问、物流异常和高价值客户异常进入人工优先队列。",
   "客服标准：英文面向客户、称呼使用客户姓名、署名Dorji / Kailash Energy；政策口径按最新站点版本核验。"
  ]}
 ],
 care:[
  {h:"一｜分层维护理念",ids:[1,2,3,4,5]},
  {h:"二｜60/120/180天生命周期",ids:[6,7,8,9]},
  {h:"三｜关系维护的记录与责任",ids:[10,11,12]},
  {h:"四｜管理仪表盘与衡量",ids:[13,14]},
  {h:"五｜维护节奏矩阵",steps:[
   "S+：无论购买日期，优先由专人一对一邀约WhatsApp；先检查授权、客诉和最近互动，不机械群发。",
   "S：提供购买关怀与精选产品/仪式建议，重点识别稳定复购和流失风险。",
   "A：结合材料和图腾偏好推荐相关新品，同时关注交付和售后体验。",
   "B：首次体验、佩戴护理、产品搭配、品牌价值和自然的第二单引导。",
   "45/60/90/120/180天：是评估节点而非必须触达节点；有未解决投诉或近期已联系则延迟营销。",
   "每次人工维护记录“为什么联系、客户如何回应、下次何时跟进”，避免重复打扰。"
  ]},
  {h:"六｜既有邮件自动化与人工边界",steps:[
   "欢迎 → 第3天精选 → 加购4小时/24小时 → 弃单2小时/24小时 → 成交 → 发货 → 签收关怀 → 60天未复购。",
   "弃单新/老客优惠规则按当期有效模板；要核对退订、频控、优惠权限与赠礼。",
   "CRM只产生下一个最佳行动建议，不擅自发送WhatsApp、退款通知或促销承诺。"
  ]}
 ],
 insight:[
  {h:"一｜标签分类与情感价值",ids:[1,2,3]},
  {h:"二｜证据分级与客户身份保护",ids:[4,5,6]},
  {h:"三｜客户心理解释与敏感界限",ids:[7,8]},
  {h:"四｜品牌语气与产品推荐",ids:[9,10]},
  {h:"五｜画像生产流程",steps:[
   "先读取Shopify明确的购买事实与产品偏好，再读取已获得授权的Gmail沟通主题和客户原话。",
   "将标签分成A客户明确表达、B可核验的购买/沟通行为、C AI推测；存证据来源和时间。",
   "情感主题限保护、疗愈、纪念、祝福等客户有证据表达的需求，不推断宗教/健康/族裔。",
   "形成一段不超过120字的运营摘要：购买事实、已证实偏好、尚未证实推断、建议动作。",
   "员工复核后才能用于个性化触达；过期证据应重算或标记“待确认”。"
  ]},
  {h:"六｜Relationship Health 的计算建议",steps:[
   "健康度与CRM价值等级分别建模；高消费不自动等于关系健康。",
   "综合未解决投诉、逾期维护、客户明确情绪、主动回信与服务满意度；缺数据时标记“未知”。",
   "默认只用于内部工作优先级，不自动对外宣称客户有心理或健康问题。"
  ]}
 ],
 brand:[
  {h:"一｜品牌事实与价值",ids:[1,2,3]},
  {h:"二｜四大图腾与寓意",ids:[4]},
  {h:"三｜仪式与服务版本",ids:[5,6,7]},
  {h:"四｜2026年11月品牌月",ids:[8,9,10,11]},
  {h:"五｜商品与传播规范",ids:[12,13,14]},
  {h:"六｜珠宝护理基础标准",steps:[
   "佩戴前确保香水护肤品干透；淋浴、游泳和清洁前摘下；湿后自然风干、独立收纳。",
   "编织作品避免长时间浸泡，不自行剪短；古董/复古部件避免湿气及过度抛光。",
   "天然石远离高温和酸碱清洁剂；木、骨、金属材质按分类护理，不做不必要化学清洗。"
  ]},
  {h:"七｜CRM使用的活动版本控制",steps:[
   "每条活动标注适用日期、参与产品、价格/优惠门槛及客服可承诺内容。",
   "临时营销机制不能长期写死在通用客服话术；以最新官网及已批准方案为准。",
   "文化寓意需准确，不承诺仪式对财富、健康和人生结果的确定效果。"
  ]}
 ]
};
function make(t,s){
 const types={h1:[3,"heading1"],h2:[4,"heading2"],p:[2,"text"],b:[12,"bullet"],o:[13,"ordered"],q:[15,"quote"]};
 const [block_type,key]=types[t];
 return {block_type,[key]:{elements:[{text_run:{content:s}}]}};
}
function signed(a,b){const x=Buffer.from(String(a||"")),y=Buffer.from(String(b||""));return !!b&&x.length===y.length&&crypto.timingSafeEqual(x,y);}
async function call(t,path,method="GET",data){
 const r=await fetch(API+path,{method,headers:{Authorization:"Bearer "+t,"Content-Type":"application/json"},...(data?{body:JSON.stringify(data)}:{})});
 const d=await r.json().catch(()=>({}));
 if(!r.ok||d.code!==0)throw new Error((d.msg||r.statusText)+" ["+path+"]");
 return d.data||d;
}
module.exports=async(req,res)=>{
 res.setHeader("Cache-Control","no-store");
 if(req.method!=="GET")return res.status(405).json({ok:false});
 if(!signed(req.query?.token,process.env.CRM_SOP_V2_TOKEN))return res.status(401).json({ok:false});
 const slug=req.query?.doc;
 if(!DOCS[slug]||!NODES[slug])return res.status(400).json({ok:false,error:"Unknown SOP"});
 try{
  const tr=await fetch(API+"/auth/v3/tenant_access_token/internal",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({app_id:process.env.FEISHU_APP_ID,app_secret:process.env.FEISHU_APP_SECRET})});
  const td=await tr.json();if(!tr.ok||td.code!==0||!td.tenant_access_token)throw new Error("Authentication failed");
  const t=td.tenant_access_token;
  const nn=await call(t,"/wiki/v2/spaces/get_node?token="+NODES[slug]);
  const node=nn.node||nn,doc=node.obj_token;
  if(!doc||node.node_token!==NODES[slug])throw new Error("SOP wiki node verification failed");
  const children="/docx/v1/documents/"+doc+"/blocks/"+doc+"/children";
  const existing=await call(t,children+"?page_size=100");
  const old=existing.items||[];
  const firstText=old.map(b=>(b.heading1?.elements||b.text?.elements||[]).map(e=>e.text_run?.content||"").join("")).join("\n");
  const marker="CRM SOP V2.0｜正式工作规范";
  if(firstText.includes(marker))return res.status(200).json({ok:true,doc:slug,already:true,blocks:old.length});
  const spec=DOCS[slug], blocks=[make("h1",spec.title),make("q",marker+"｜2026-11-08｜负责人已确认的CRM规则与日常工作流程"),make("p","负责人：Kailash Energy 经营部／CRM｜资料性质：内部工作SOP｜数据以Shopify/Gmail原系统为准")];
  for(const section of LAYOUT[slug]){
   blocks.push(make("h2",section.h));
   for(const i of section.ids||[]){
    const s=spec.lines[i];if(s)blocks.push(make(i>=4&&i<=10?"b":"p",s));
   }
   for(const s of section.steps||[])blocks.push(make("o",s));
  }
  blocks.push(make("h2","相关入口与验收说明"));
  blocks.push(make("p","CRM首页：https://ycnic6l8vkfx.feishu.cn/wiki/ISzIwGiJQi20Q4kUioGcojmwnWf"));
  blocks.push(make("p","CRM两张业务表：https://ycnic6l8vkfx.feishu.cn/wiki/OSUew3QCUics0vkuphJc2sDfnGf"));
  blocks.push(make("q","本页为SOP，不代表全量客户/邮件已同步；自动化、仪表盘与客户数据需分别验收。"));
  let inserted=0;
  for(let i=0;i<blocks.length;i+=18){
   await call(t,children,"POST",{children:blocks.slice(i,i+18)});
   inserted+=Math.min(18,blocks.length-i);
  }
  const originalCount=old.length;
  if(originalCount){
   await call(t,children+"/batch_delete","DELETE",{start_index:0,end_index:originalCount});
  }
  return res.status(200).json({ok:true,doc:slug,new_blocks:inserted,old_blocks_replaced:originalCount,url:"https://ycnic6l8vkfx.feishu.cn/wiki/"+NODES[slug]});
 }catch(e){return res.status(502).json({ok:false,doc:slug,error:String(e.message).slice(0,500)});}
};