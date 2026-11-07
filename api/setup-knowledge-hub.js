const crypto = require("crypto");

const API = "https://open.feishu.cn/open-apis";
const DOCS = [
  ["01 Brand Strategy & Guidelines", "品牌定位、品牌主张、目标市场、受众画像、品牌语言、视觉原则与内容规范。"],
  ["02 CRM Rules & Customer Management", "CRM 客户分层规则：M 为近180天累计消费净额，R 为距最近下单天数，F 为近180天有效订单数。S+：M≥3000、R≤45、F≥5；S：M≥1500、R≤90、F≥3；A：M≥800、R≤180、F≥2；B：M>0、R≤180、F≥1。需同时满足全部条件，取最高等级；R>180且历史购买过的客户归为沉睡；从未购买单独管理。客单价分组不改变等级规则。"],
  ["03 Marketing Strategy & Campaign Plans", "沉淀广告投放、ROAS、邮件营销、社媒、KOL、活动机制、Campaign 计划与复盘。目标 ROAS 参考值 2.3，所有活动机制以最新批准版本为准。"],
  ["04 Product Knowledge & Materials", "产品名称、材料、工艺、尺寸、文化寓意、SEO、产品故事与护理说明。古董主体与当代新制镶嵌必须明确区分，不得将整件新制成品误称为古董。"],
  ["05 Operations SOP & Team Responsibilities", "客户服务、物流、补发、赠品、采购、仓储、履约、售后及岗位职责。所有客户订单修改和对外发送操作必须有授权与审计记录。"]
];
const BASE_TABLES = [
  {name:"Customer Master",fields:["Customer ID","Customer Name","Email","Country","CRM Tier","Net Spend 180d","Last Order Date","Orders 180d","Lifetime Spend","Shopify Customer ID","Last Contact Date","Owner","Status","Notes"]},
  {name:"Customer Communication Timeline",fields:["Interaction ID","Customer ID","Date","Channel","Direction","Subject","Summary","Customer Intent","Sentiment","Order ID","Resolution","Next Action","Owner","Source Link"]},
  {name:"Customer Follow-up Tasks",fields:["Task ID","Customer ID","Task","Priority","Owner","Due Date","Status","Related Order","Created From","Notes"]},
  {name:"Product Knowledge",fields:["Product ID","Product Name","Collection","Materials","Craftsmanship","Symbolism","Size","SEO Title","Short Description","Product Story","Care Instructions","Source URL","Updated At"]},
  {name:"Marketing Campaigns",fields:["Campaign ID","Campaign Name","Channel","Audience","Start Date","End Date","Offer Mechanics","Budget","Revenue","ROAS","Status","Owner","Post-campaign Review"]},
  {name:"AI Conversation & Decision Log",fields:["Log ID","Date","Chat ID","Requester","Question","Analysis Summary","Evidence Sources","Decision","Action Items","Knowledge References","Sensitivity"]},
  {name:"Knowledge Version Log",fields:["Version ID","Date","Module","Change Summary","Previous Version","New Version","Approved By","Source","Status"]}
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
  const supplied=(req.headers.authorization||"").replace(/^Bearer\\s+/i,"");
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

    const spaces=await api(token,"/wiki/v2/spaces?page_size=100");
    const existing=(spaces.items||spaces.spaces||[]).find(s=>s.name==="Kailash Energy AI Knowledge Hub");
    const space=existing || await api(token,"/wiki/v2/spaces","POST",{name:"Kailash Energy AI Knowledge Hub"});
    const spaceId=space.space_id || space.space?.space_id;
    if(!spaceId) throw new Error("Wiki space created/listed but space_id missing: "+JSON.stringify(space));

    let nodesPage=await api(token,"/wiki/v2/spaces/"+spaceId+"/nodes?page_size=100");
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
          const blocks=await api(token,"/docx/v1/documents/"+root+"/blocks?page_size=100");
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
      const bases=await api(token,"/bitable/v1/apps?page_size=100");
      const existingBase=(bases.apps||bases.items||[]).find(a=>a.name==="Kailash Energy AI Operations Database");
      const base=existingBase || await api(token,"/bitable/v1/apps","POST",{name:"Kailash Energy AI Operations Database"});
      const appToken=base.app?.app_token||base.app_token;
      created.bitable={app_token:appToken||null,url:base.app?.url||base.url||null};
      if(appToken){
        const listed=await api(token,"/bitable/v1/apps/"+appToken+"/tables?page_size=100");
        const tables=listed.items||listed.tables||[];
        for(const spec of BASE_TABLES){
          if(tables.some(t=>t.name===spec.name)){created.tables.push({name:spec.name,status:"exists"});continue;}
          const fields=spec.fields.map((field,i)=>({field_name:field,type:1}));
          try{
            const result=await api(token,"/bitable/v1/apps/"+appToken+"/tables","POST",{table:{name:spec.name,fields}});
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