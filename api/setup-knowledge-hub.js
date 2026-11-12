const crypto = require("crypto");

const API = "https://open.feishu.cn/open-apis";
const DOCS = [
  ["01 品牌战略与品牌规范", "品牌定位、品牌主张、目标市场、受众画像、品牌语言、视觉原则与内容规范。"],
  ["02 CRM规则与客户管理", "CRM 客户分层规则：等级使用历史累计消费（不限时间，USD）和近180天有效订单次数。S+专属服务客户≥3000；S重点客户1500至小于3000；A成长客户800至小于1500；B基础客户大于0至小于800；上述均要求近180天至少1单。历史累计大于0且近180天0单为沉睡；从未购买单独管理。行为RFM的M为近180天净消费，R为距最近有效购买天数，F为近180天有效订单数，与等级独立。客单价分组不改变等级规则。"],
  ["03 营销策略与活动方案", "沉淀广告投放、ROAS、邮件营销、社媒、KOL、活动机制、营销活动计划与复盘。目标 ROAS 参考值 2.3，所有活动机制以最新批准版本为准。"],
  ["04 产品知识与材料数据库", "产品名称、材料、工艺、尺寸、文化寓意、SEO、产品故事与护理说明。古董主体与当代新制镶嵌必须明确区分，不得将整件新制成品误称为古董。"],
  ["05 运营标准流程与团队职责", "客户服务、物流、补发、赠品、采购、仓储、履约、售后及岗位职责。所有客户订单修改和对外发送操作必须有授权与审计记录。"]
];
const BASE_TABLES = [
  {name:"客户主档案",fields:["客户唯一编号","客户姓名","邮箱","国家/地区","CRM 客户等级","近180天净消费","最近下单日期","近180天有效订单数","历史累计消费","Shopify客户编号","最近记录日期","负责人","状态","备注"]},
  {name:"客户历史沟通记录",fields:["沟通记录编号","客户唯一编号","记录日期","渠道","方向","邮件主题","摘要","客户意图","客户情绪","关联订单编号","处理结果","下一步行动","负责人","来源链接"]},
  {name:"客户跟进任务",fields:["任务编号","客户唯一编号","任务内容","优先级","负责人","截止日期","状态","关联订单","任务来源","备注"]},
  {name:"产品知识库",fields:["产品编号","产品名称","产品系列","材料","制作工艺","文化寓意","尺寸","SEO 标题","简短描述","产品故事","保养说明","来源链接","更新时间"]},
  {name:"营销活动数据库",fields:["活动编号","活动名称","渠道","目标受众","开始日期","结束日期","活动机制","预算","营收","ROAS","状态","负责人","活动复盘"]},
  {name:"AI 对话与决策记录",fields:["记录编号","记录日期","群聊编号","提问人","问题","分析摘要","证据来源","决策结论","行动事项","关联知识","敏感级别"]},
  {name:"知识版本更新记录",fields:["版本编号","记录日期","知识模块","变更摘要","旧版本","新版本","批准人","更新来源","状态"]}
];

async function api(token, path, method="GET", body) {
  const r = await fetch(API + path, {
    method,
    headers: {Authorization:"Bearer "+token,"Content-Type":"application/json; charset=utf-8"},
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await r.json().catch(()=>({}));
  if (!r.ok || (typeof data.code === "number" && data.code !== 0)) {
    const e = new Error((data.msg || data.message || r.statusText) + " [" + path + "]");
    e.status = r.status; e.code = data.code; e.data = data; throw e;
  }
  return data.data || data;
}
async function tenantToken() {
  const r = await fetch(API+"/auth/v3/tenant_access_token/internal",{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({app_id:process.env.FEISHU_APP_ID,app_secret:process.env.FEISHU_APP_SECRET})
  });
  const d=await r.json();
  if(!r.ok || d.code!==0 || !d.tenant_access_token) throw new Error("Feishu auth failed: "+(d.msg||r.status));
  return d.tenant_access_token;
}
function auth(req,res) {
  const supplied=(req.headers.authorization||"").replace(/^Bearer\s+/i,"");
  const expected=process.env.REPORT_GATEWAY_TOKEN||"";
  const a=Buffer.from(supplied), b=Buffer.from(expected);
  if(!expected || a.length!==b.length || !crypto.timingSafeEqual(a,b)){res.status(401).json({ok:false,error:"Unauthorized"});return false;}
  return true;
}
module.exports = async (req,res) => {
  if(req.method!=="POST") return res.status(405).json({ok:false,error:"Method not allowed"});
  if(!auth(req,res)) return;
  if(!process.env.FEISHU_APP_ID || !process.env.FEISHU_APP_SECRET) return res.status(503).json({ok:false,error:"Missing Feishu app credentials"});
  try {
    const token=await tenantToken();
    const created={documents:[],bitable:null,tables:[],warnings:[]};

    const spaces=await api(token,"/wiki/v2/spaces?page_size=50");
    const existing=(spaces.items||spaces.spaces||[]).find(s=>s.name==="Kailash Energy AI 知识中心");
    const space=existing || await api(token,"/wiki/v2/spaces","POST",{name:"Kailash Energy AI 知识中心"});
    const spaceId=space.space_id || space.space?.space_id;
    if(!spaceId) throw new Error("Wiki space created/listed but space_id missing: "+JSON.stringify(space));

    let nodesPage=await api(token,"/wiki/v2/spaces/"+spaceId+"/nodes?page_size=50");
    let nodes=nodesPage.items||nodesPage.nodes||[];
    for(const [title,summary] of DOCS){
      let node=nodes.find(n=>n.title===title);
      if(!node){
        const result=await api(token,"/wiki/v2/spaces/"+spaceId+"/nodes","POST",{
          obj_type:"docx",node_type:"origin",parent_node_token:"",title
        });
        node=result.node||result;
      }
      const objToken=node.obj_token||node.objToken;
      const nodeToken=node.node_token||node.nodeToken;
      if(objToken){
        try {
          const doc=await api(token,"/docx/v1/documents/"+objToken);
          const root=doc.document?.document_id||objToken;
          const blocks=await api(token,"/docx/v1/documents/"+root+"/blocks?page_size=50");
          const children=blocks.items||blocks.blocks||[];
          if(children.length===0){
            const parent=doc.document?.document_id||objToken;
            await api(token,"/docx/v1/documents/"+parent+"/blocks/"+parent+"/children","POST",{
              children:[{block_type:2,text:{elements:[{text_run:{content:summary}}]}}]
            });
          }
        } catch(e) { created.warnings.push("Document content initialization for "+title+": "+e.message); }
      }
      created.documents.push({title,node_token:nodeToken||null,obj_token:objToken||null,url:nodeToken?"https://www.feishu.cn/wiki/"+nodeToken:null});
    }

    try {
      const bases=await api(token,"/bitable/v1/apps?page_size=50");
      const existingBase=(bases.apps||bases.items||[]).find(a=>a.name==="Kailash Energy AI 运营数据库");
      const base=existingBase || await api(token,"/bitable/v1/apps","POST",{name:"Kailash Energy AI 运营数据库"});
      const appToken=base.app?.app_token||base.app_token;
      created.bitable={app_token:appToken||null,url:base.app?.url||base.url||null};
      if(appToken){
        const listed=await api(token,"/bitable/v1/apps/"+appToken+"/tables?page_size=50");
        const tables=listed.items||listed.tables||[];
        for(const spec of BASE_TABLES){
          if(tables.some(t=>t.name===spec.name)){created.tables.push({name:spec.name,status:"exists"});continue;}
          const fields=spec.fields.map((field)=>({field_name:field,type:1}));
          try{
            const result=await api(token,"/bitable/v1/apps/"+appToken+"/tables","POST",{table:{name:spec.name},fields});
            const t=result.table||result;
            created.tables.push({name:spec.name,table_id:t.table_id||null,status:"created"});
          }catch(e){created.warnings.push("Table "+spec.name+": "+e.message);}
        }
      } else created.warnings.push("Bitable created but app_token missing; table initialization skipped.");
    } catch(e){created.warnings.push("Bitable initialization: "+e.message);}

    return res.status(200).json({ok:true,space_id:spaceId,space_url:"https://www.feishu.cn/wiki/"+spaceId,...created});
  } catch(e) {
    return res.status(e.status||502).json({ok:false,error:e.message,code:e.code||null,details:e.data||null});
  }
};