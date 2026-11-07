const API="https://open.feishu.cn/open-apis";
module.exports=async(req,res)=>{
 try{
 const ar=await fetch(API+"/auth/v3/tenant_access_token/internal",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({app_id:process.env.FEISHU_APP_ID,app_secret:process.env.FEISHU_APP_SECRET})});
 const a=await ar.json(); if(!ar.ok||a.code!==0) throw new Error(a.msg||"auth failed");
 const h={Authorization:"Bearer "+a.tenant_access_token};
 const space="7705493095961332747";
 const [sr,mr]=await Promise.all([
 fetch(API+"/wiki/v2/spaces/"+space,{headers:h}),
 fetch(API+"/wiki/v2/spaces/"+space+"/members?page_size=100",{headers:h})
 ]);
 const [s,m]=await Promise.all([sr.json(),mr.json()]);
 return res.status(200).json({ok:true,app_id:process.env.FEISHU_APP_ID,space:{http:sr.status,code:s.code,msg:s.msg,data:s.data},members:{http:mr.status,code:m.code,msg:m.msg,items:m.data?.members||[],has_more:m.data?.has_more}});
 }catch(e){return res.status(502).json({ok:false,error:e.message});}
};