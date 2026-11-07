const API="https://open.feishu.cn/open-apis";
module.exports=async(req,res)=>{
 try{
 const ar=await fetch(API+"/auth/v3/tenant_access_token/internal",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({app_id:process.env.FEISHU_APP_ID,app_secret:process.env.FEISHU_APP_SECRET})});
 const a=await ar.json(); if(!ar.ok||a.code!==0) throw new Error(a.msg||"auth failed");
 const h={Authorization:"Bearer "+a.tenant_access_token};
 const space="7705493095961332747";
 const [sr,nr]=await Promise.all([
 fetch(API+"/wiki/v2/spaces/"+space,{headers:h}),
 fetch(API+"/wiki/v2/spaces/"+space+"/nodes?page_size=10",{headers:h})
 ]);
 const [s,n]=await Promise.all([sr.json(),nr.json()]);
 return res.status(200).json({ok:true,app_id:process.env.FEISHU_APP_ID,space:{http:sr.status,code:s.code,msg:s.msg,data:s.data},node_read:{http:nr.status,code:n.code,msg:n.msg,items:n.data?.items||[],has_more:n.data?.has_more},diagnostic:"The public Wiki v2 API exposes add/delete member methods, not a member-list method. Node listing is used to verify app read access."});
 }catch(e){return res.status(502).json({ok:false,error:e.message});}
};