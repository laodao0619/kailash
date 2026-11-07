const API="https://open.feishu.cn/open-apis";
async function api(token,path){
 const r=await fetch(API+path,{headers:{Authorization:"Bearer "+token}});
 const d=await r.json();
 if(!r.ok||d.code!==0) throw new Error((d.msg||r.statusText)+" ["+path+"]");
 return d.data||d;
}
module.exports=async(req,res)=>{
 if(req.method!=="GET") return res.status(405).json({ok:false,error:"Method not allowed"});
 // Read-only inspection endpoint; access is restricted by Vercel Deployment Protection / SSO.
 try{
  const tr=await fetch(API+"/auth/v3/tenant_access_token/internal",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({app_id:process.env.FEISHU_APP_ID,app_secret:process.env.FEISHU_APP_SECRET})});
  const td=await tr.json();
  if(!tr.ok||td.code!==0||!td.tenant_access_token) throw new Error("Feishu auth failed: "+(td.msg||tr.status));
  const token=td.tenant_access_token;
  const wikiNodeToken=process.env.EXISTING_WIKI_NODE_TOKEN||"OSUew3QCUics0vkuphJc2sDfnGf";
  const bitableTableId=process.env.EXISTING_WIKI_TABLE_ID||"tblbk7Ju6fcM1BXF";
  const node=await api(token,"/wiki/v2/spaces/get_node?token="+encodeURIComponent(wikiNodeToken));
  const n=node.node||node;
  const result={
   ok:true,mode:"read_only_inspection",
   wiki:{node_token:wikiNodeToken,obj_type:n.obj_type||null,obj_token:n.obj_token||null,space_id:n.space_id||null,title:n.title||null},
   bitable:{table_id:bitableTableId,app_token:n.obj_type==="bitable"?n.obj_token:null},
   policy:{will_not_create_new_wiki:true,will_not_modify_product_base:true,will_not_create_or_modify_tables_during_inspection:true}
  };
  if(n.obj_type==="bitable"&&n.obj_token){
    const tables=await api(token,"/bitable/v1/apps/"+n.obj_token+"/tables?page_size=50");
    result.bitable.tables=(tables.items||tables.tables||[]).map(t=>({table_id:t.table_id,name:t.name}));
    result.bitable.table_details=[];
    for(const t of (tables.items||tables.tables||[])){
      const fields=await api(token,"/bitable/v1/apps/"+n.obj_token+"/tables/"+t.table_id+"/fields?page_size=100");
      const records=await api(token,"/bitable/v1/apps/"+n.obj_token+"/tables/"+t.table_id+"/records?page_size=1");
      result.bitable.table_details.push({
        table_id:t.table_id,
        name:t.name,
        fields:(fields.items||fields.fields||[]).map(f=>({field_id:f.field_id,field_name:f.field_name,type:f.type})),
        total_records:records.total??records.total_count??null
      });
    }
    result.bitable.selected_table=result.bitable.table_details.find(t=>t.table_id===bitableTableId)||null;
  }
  return res.status(200).json(result);
 }catch(e){return res.status(502).json({ok:false,error:e.message,code:e.code||null});}
};