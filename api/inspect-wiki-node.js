const API="https://open.feishu.cn/open-apis";
module.exports=async(req,res)=>{
 if(req.method!=="GET") return res.status(405).json({ok:false});
 const expected=process.env.REPORT_GATEWAY_TOKEN||"";
 const got=(req.headers.authorization||"").replace(/^Bearer\\s+/i,"");
 if(!expected||got!==expected)return res.status(401).json({ok:false,error:"Unauthorized"});
 const tokenArg=req.query.token;
 if(!tokenArg) return res.status(400).json({ok:false,error:"Missing wiki node token"});
 try{
  const ar=await fetch(API+"/auth/v3/tenant_access_token/internal",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({app_id:process.env.FEISHU_APP_ID,app_secret:process.env.FEISHU_APP_SECRET})});
  const a=await ar.json();
  if(!ar.ok||a.code!==0) throw new Error(a.msg||"Authentication failed");
  const r=await fetch(API+"/wiki/v2/spaces/get_node?token="+encodeURIComponent(tokenArg),{headers:{Authorization:"Bearer "+a.tenant_access_token}});
  const d=await r.json();
  if(!r.ok||d.code!==0) throw new Error(d.msg||"Wiki node lookup failed");
  const n=d.data?.node||d.data||{};
  return res.status(200).json({ok:true,read_only:true,node_token:tokenArg,obj_type:n.obj_type||null,obj_token:n.obj_token||null,space_id:n.space_id||null,parent_node_token:n.parent_node_token||null,title:n.title||null,has_children:n.has_child||false});
 }catch(e){return res.status(502).json({ok:false,error:e.message});}
};