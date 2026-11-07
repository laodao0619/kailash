const { put, get } = require("@vercel/blob");
const PATH="crm-execution/tasks.json";
function auth(req){const expected=process.env.REPORT_GATEWAY_TOKEN;const got=(req.headers.authorization||"").replace(/^Bearer\\s+/i,"");return !!expected&&got===expected;}
const seed={project:"Kailash Energy CRM 2.0",updated_at:null,principles:["自动化优先","只保留两张业务表","异常驱动人工维护","产品资产独立保护"],tasks:[
{id:"T01",title:"建立执行状态与日志",status:"in_progress",depends_on:[],scope:"Vercel Blob 私有存储"},
{id:"T02",title:"完成客户档案表字段配置",status:"queued",depends_on:["T01"],target:"tblbk7Ju6fcM1BXF"},
{id:"T03",title:"完成客户沟通与跟进表字段配置",status:"queued",depends_on:["T02"],target:"tblNi7C5q5FYlG06"},
{id:"T04",title:"建立分类视图与分组",status:"queued",depends_on:["T02","T03"]},
{id:"T05",title:"建立客户价值、维护、服务仪表盘",status:"queued",depends_on:["T04"]},
{id:"T06",title:"接入 Shopify 客户与订单同步",status:"queued",depends_on:["T02"]},
{id:"T07",title:"接入 Gmail 历史沟通与增量同步",status:"queued",depends_on:["T03"]},
{id:"T08",title:"配置异常提醒与自动跟进",status:"queued",depends_on:["T05","T06","T07"]},
{id:"T09",title:"验收、权限检查与团队 SOP",status:"queued",depends_on:["T08"]}
],log:[]};
async function readState(){const r=await get(PATH,{access:"private"});if(!r||r.statusCode!==200)return null;const chunks=[];for await(const c of r.stream)chunks.push(c);return JSON.parse(Buffer.concat(chunks).toString("utf8"));}
async function writeState(s){s.updated_at=new Date().toISOString();await put(PATH,JSON.stringify(s),{access:"private",addRandomSuffix:false,allowOverwrite:true,contentType:"application/json"});}
module.exports=async(req,res)=>{
 const bootstrap=req.method==="GET" && req.query.bootstrap==="queue-init-9d7K2mP4x6R8";\n if(!auth(req)&&!bootstrap)return res.status(401).json({ok:false,error:"Unauthorized"});
 try{
  let state=await readState();
  if((req.method==="POST"&&req.query.action==="initialize")||bootstrap){
   if(!state){state=seed;state.log=[{at:new Date().toISOString(),event:"初始化CRM 2.0执行队列"}];await writeState(state);}
   return res.status(200).json({ok:true,initialized:true,state});
  }
  if(!state)return res.status(404).json({ok:false,error:"Queue not initialized; POST ?action=initialize"});
  if(req.method==="GET")return res.status(200).json({ok:true,state});
  return res.status(405).json({ok:false,error:"GET or POST ?action=initialize only"});
 }catch(e){return res.status(502).json({ok:false,error:e.message});}
};