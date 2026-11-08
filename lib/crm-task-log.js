"use strict";
const {get,put}=require("@vercel/blob");
const PATH="crm-execution/tasks.json";
async function mark(id,status,detail){
 try{
  const r=await get(PATH,{access:"private"});if(!r||r.statusCode!==200)return;
  const chunks=[];for await(const c of r.stream)chunks.push(c);
  const ledger=JSON.parse(Buffer.concat(chunks).toString("utf8"));
  const task=(ledger.tasks||[]).find(x=>x.id===id);if(!task)return;
  if(task.status==="done"&&status!=="done")return;
  task.status=status;task.last_run_at=new Date().toISOString();
  task.detail=String(detail||"").slice(0,180);
  ledger.log=(ledger.log||[]).slice(-100);
  ledger.log.push({at:task.last_run_at,event:"CRM task "+id+" "+status,detail:task.detail});
  ledger.updated_at=task.last_run_at;
  await put(PATH,JSON.stringify(ledger),{access:"private",addRandomSuffix:false,allowOverwrite:true,contentType:"application/json"});
 }catch(e){/* Task ledger must never block customer data checkpoint. */}
}
module.exports={mark};
