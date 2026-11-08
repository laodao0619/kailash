module.exports=async(_req,res)=>{res.setHeader("Cache-Control","no-store");return res.status(410).json({ok:false,error:"One-time table rename operation completed and retired"});};
