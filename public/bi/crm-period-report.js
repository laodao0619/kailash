"use strict";
(function(root){
 function initialize({$,request,state,esc}){
  let data=null,kind='daily';
  const metrics=[['emailAdded','邮件累计新增'],['subscriptionRate','客户订阅率'],['buyers','购买总人数'],['newBuyers','新客户数'],['newConversion','新客户转化率'],['returningBuyers','回头客数'],['retention','客户留存率'],['ltv','LTV'],['cac','CAC'],['ltvCac','LTV/CAC']];
  function render(){
   if(!data)return;
   const fmt=(k,v)=>v==null?'—':['subscriptionRate','newConversion','retention'].includes(k)?v.toFixed(2)+'%':['ltv','cac'].includes(k)?data.currency+' '+v.toFixed(2):k==='ltvCac'?v.toFixed(2):v.toLocaleString('en-US');
   $('crm-report-status').textContent='更新：'+new Date(data.generatedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})+'（北京） · 统计时区：'+data.timezone+' · 截至 '+data.through+(Object.keys(data.sourceErrors).length?' · 部分来源待接入，见下方说明':'');
   $('crm-report-table').innerHTML='<thead><tr><th>统计周期</th>'+metrics.map(([k,t])=>'<th title="'+esc(data.definitions[k]||'')+'">'+t+'</th>').join('')+'<th>广告口径</th><th>花费录入</th></tr></thead><tbody>'+[...data[kind]].reverse().map((r,i)=>'<tr><td style="white-space:nowrap">'+esc(r.start+(r.start===r.end?'':' ～ '+r.end))+(!r.complete?' · 未完周':'')+'</td>'+metrics.map(([k])=>'<td>'+esc(fmt(k,r[k]))+'</td>').join('')+'<td>'+esc(r.adScope)+'</td><td><button data-spend="'+i+'">录入 / 修改</button></td></tr>').join('')+'</tbody>';
   $('crm-report-notes').textContent=data.notes.join(' ')+(data.sourceErrors.meta?' Meta状态：'+data.sourceErrors.meta+'。':'');
   const rows=[...data[kind]].reverse();
   $('crm-report-table').querySelectorAll('[data-spend]').forEach(b=>b.onclick=()=>{
    const r=rows[Number(b.dataset.spend)];$('crm-spend-period').value=r.start+'_'+r.end;
    $('crm-spend-label').textContent=r.start+' ～ '+r.end+' · '+data.currency+' · 仅填本周期获客广告花费';
    $('crm-spend-meta').value=r.metaSpend??'';$('crm-spend-google').value=r.googleSpend??'';
    $('crm-spend-editor').hidden=false;
   });
  }
  async function refresh(force=false){
   if(!state.token)return;
   $('crm-report-status').textContent=force?'正在重新拉取 Shopify 与广告数据…':'正在读取日报周报…';
   $('crm-report-refresh').disabled=true;
   try{const r=await request('/api/bi-crm-report',force?{refresh:'1'}:{});data=r.data;render();if(r.stale)$('crm-report-status').textContent+=' · 数据已过期 / 本次刷新失败';}
   catch(e){$('crm-report-status').textContent='报表读取失败：'+e.message;}
   finally{$('crm-report-refresh').disabled=false;}
  }
  $('crm-report-kind').onchange=e=>{kind=e.target.value;render()};
  $('crm-report-refresh').onclick=()=>refresh(true);
  $('crm-report-download').onclick=async()=>{
   try{const r=await fetch('/api/bi-crm-report?format=csv&kind='+kind,{headers:{Authorization:'Bearer '+state.token},cache:'no-store'});if(!r.ok||!r.headers.get('content-type')?.includes('text/csv'))throw Error('导出失败');const u=URL.createObjectURL(await r.blob());const a=document.createElement('a');a.href=u;a.download='Kailash_CRM_'+kind+'.csv';a.click();URL.revokeObjectURL(u);}
   catch(e){$('crm-report-status').textContent=e.message;}
  };
  $('crm-spend-cancel').onclick=()=>{$('crm-spend-editor').hidden=true};
  $('crm-spend-save').onclick=async()=>{
   const [start,end]=$('crm-spend-period').value.split('_');
   const val=id=>$(id).value.trim()===''?null:Number($(id).value);
   const body={start,end,currency:data.currency,metaSpend:val('crm-spend-meta'),googleSpend:val('crm-spend-google')};
   if([body.metaSpend,body.googleSpend].some(v=>v!==null&&(!Number.isFinite(v)||v<0))){$('crm-report-status').textContent='请输入非负花费，空白表示未提供。';return;}
   $('crm-spend-save').disabled=true;
   try{const r=await fetch('/api/bi-crm-report',{method:'POST',headers:{Authorization:'Bearer '+state.token,'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json();if(!r.ok||!d.ok)throw Error(d.error||'保存失败');data=d.data;render();$('crm-spend-editor').hidden=true;}
   catch(e){$('crm-report-status').textContent=e.message;}
   finally{$('crm-spend-save').disabled=false;}
  };
  return {refresh};
 }
 root.KBICRMPeriodReport={initialize};
})(typeof window!=='undefined'?window:globalThis);
