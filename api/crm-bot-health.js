const API="https://open.feishu.cn/open-apis";
module.exports=async(req,res)=>{
 res.setHeader("Cache-Control","no-store");
 if(req.method!=="GET")return res.status(405).json({ok:false});
 const id=process.env.FEISHU_CHAT_ID;
 if(!id||!process.env.FEISHU_APP_ID||!process.env.FEISHU_APP_SECRET)return res.status(200).json({ok:false,reason:"missing_bot_group_configuration"});
 try{
 const a=await fetch(API+"/auth/v3/tenant_access_token/internal",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({app_id:process.env.FEISHU_APP_ID,app_secret:process.env.FEISHU_APP_SECRET})});
 const auth=await a.json();
 if(!a.ok||auth.code!==0||!auth.tenant_access_token) return res.status(200).json({ok:false,reason:"feishu_auth_failed"});
 const r=await fetch(API+"/im/v1/chats/"+encodeURIComponent(id),{headers:{Authorization:"Bearer "+auth.tenant_access_token}});
 const j=await r.json();
 const groupFound=r.ok&&j.code===0&&!!j.data;
 return res.status(200).json({ok:groupFound,group_configured:true,group_reachable:groupFound,bot_has_openai:!!process.env.OPENAI_API_KEY,bot_group_query_ready:groupFound,bot_command_examples:["CRM帮助","RFM","CRM旅程","CRM画像","客户 <邮箱>"],error_code:groupFound?null:j.code||r.status});
 }catch(e){return res.status(200).json({ok:false,reason:"feishu_chat_unreachable"});}
};