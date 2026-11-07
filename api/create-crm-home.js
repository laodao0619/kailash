const API="https://open.feishu.cn/open-apis";
async function call(token,path,method="GET",body){
 const r=await fetch(API+path,{method,headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},...(body?{body:JSON.stringify(body)}:{})});
 const d=await r.json();
 if(!r.ok||d.code!==0) throw new Error((d.msg||r.statusText)+" ["+path+"]");
 return d.data||d;
}
module.exports=async(req,res)=>{
 if(req.method!=="GET" || req.query.once!=="crmhome-Q7m2p9V4x8N1") return res.status(405).json({ok:false,error:"One-time invocation only"});
 try{
  const auth=await fetch(API+"/auth/v3/tenant_access_token/internal",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({app_id:process.env.FEISHU_APP_ID,app_secret:process.env.FEISHU_APP_SECRET})});
  const ad=await auth.json();
  if(!auth.ok||ad.code!==0||!ad.tenant_access_token) throw new Error("Feishu authentication failed: "+(ad.msg||auth.status));
  const token=ad.tenant_access_token;
  const spaceId="7705493095961332747";
  const existingNode="Qj7LwHjFPi5FDykKnKTc6kiOn84";
  const title="Kailash Energy｜客户关系管理中心";
  const children=[
   "KAILASH ENERGY｜客户关系管理中心",
   "统一客户档案、客户维护、售后管理与经营分析的团队入口。",
   "一、客户管理",
   "客户档案：进入现有客户档案多维表格，查询客户身份、消费价值、CRM等级、RFM分群、用户画像和生命周期。",
   "RFM客户分群：按最近购买时间（R）、购买频率（F）和消费金额（M）识别客户价值与运营机会。",
   "二、客户维护",
   "重点客户维护：查看S+与S客户、负责人、维护日期和下一步最佳行动。",
   "今日维护任务：查看待处理、即将到期和逾期事项。",
   "三、客服与售后",
   "历史沟通档案：查看Gmail邮件、客户咨询和历史处理结果。",
   "售后问题管理：跟踪退款、物流异常、产品问题、投诉及解决状态。",
   "四、经营分析",
   "客户价值仪表盘：CRM等级分布、RFM分群、消费贡献、复购与生命周期。",
   "客户维护仪表盘：关系健康度、高价值客户维护、风险客户和任务完成情况。",
   "客户服务仪表盘：邮件响应时间、售后问题、解决时长和逾期事项。",
   "五、运营规范与知识库",
   "CRM客户分层规则、RFM模型说明、客户维护SOP、售后处理流程、AI机器人使用说明。",
   "数据原则：Shopify是客户与订单数据来源；Gmail是邮件原文来源；飞书保存客户经营摘要、人工处理结果和维护任务。",
   "使用原则：优先自动同步和AI分析；员工重点处理异常、客户关系维护和需要人工判断的事项。",
   "数据保护：产品资产库独立管理。本CRM项目未经明确批准，不修改产品表格字段、记录或文件。",
   "实施状态：本页面为导航框架。客户表字段、视图、仪表盘和自动化将在逐项审核批准后配置。"
  ];
  const listed=await call(token,"/wiki/v2/spaces/"+spaceId+"/nodes?page_size=100");
  const found=(listed.items||[]).find(x=>x.title===title);
  let n=found||null, created=false;
  if(!n){
   const node=await call(token,"/wiki/v2/spaces/"+spaceId+"/nodes","POST",{obj_type:"docx",node_type:"origin",title});
   n=node.node||node; created=true;
  }
  const docId=n.obj_token;
  if(!docId) throw new Error("Wiki node exists but document token was not returned");
  const current=await call(token,"/docx/v1/documents/"+docId+"/blocks/"+docId+"/children?page_size=100");
  let inserted=null;
  if(!(current.items||[]).length){
   const blocks=children.map(s=>({block_type:2,text:{elements:[{text_run:{content:s}}]}}));
   inserted=await call(token,"/docx/v1/documents/"+docId+"/blocks/"+docId+"/children","POST",{children:blocks,index:0});
  }
  return res.status(200).json({ok:true,created,title,node_token:n.node_token,document_id:docId,space_id:spaceId,paragraph_count:children.length,content_written:!!inserted||((current.items||[]).length>0),inserted});
 }catch(e){return res.status(502).json({ok:false,error:e.message});}
};