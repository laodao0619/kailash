const {get}=require("@vercel/blob");
module.exports=async(req,res)=>{
  res.setHeader("Cache-Control","no-store");
  if(req.method!=="GET") return res.status(405).json({ok:false});
  try{
    const file=await get("crm-execution/tasks.json",{access:"private"});
    if(!file||file.statusCode!==200)return res.status(503).json({ok:false,status:"not_initialized"});
    const chunks=[];for await(const c of file.stream)chunks.push(c);
    const state=JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return res.status(200).json({
      ok:true,
      project:"Kailash Energy CRM 2.0",
      updated_at:state.updated_at||null,
      tasks:(state.tasks||[]).map(x=>({id:x.id,status:x.status,last_run_at:x.last_run_at||null})),
      last_event_at:(state.log||[]).at(-1)?.at||null
    });
  }catch(e){return res.status(502).json({ok:false,status:"unavailable"});}
};