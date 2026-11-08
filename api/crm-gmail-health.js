const gmail=require("../lib/crm-gmail");
module.exports=async(req,res)=>{
 res.setHeader("Cache-Control","no-store");
 if(req.method!=="GET")return res.status(405).json({ok:false});
 const configured=!!(process.env.GMAIL_CLIENT_ID&&process.env.GMAIL_CLIENT_SECRET&&process.env.GMAIL_REFRESH_TOKEN);
 if(!configured)return res.status(200).json({ok:false,stage:"configuration",category:"credentials_missing"});
 try{
  const token=await gmail.token();
  const response=await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile",{headers:{Authorization:"Bearer "+token}});
  const body=await response.json().catch(()=>({}));
  if(!response.ok)return res.status(200).json({ok:false,stage:"gmail_read",status:response.status,code:body.error?.status||"unknown"});
  return res.status(200).json({ok:true,oauth_refresh:"verified",gmail_api:"verified",profile_access:true,mailbox_message_count:body.messagesTotal??null,no_personal_data_returned:true});
 }catch(e){
  const msg=String(e.message||"");
  return res.status(200).json({ok:false,stage:"token_refresh",category:msg.includes("not authorized")?"credentials_missing":msg.includes("token refresh")?"invalid_grant_or_oauth":"connection_failed"});
 }
};