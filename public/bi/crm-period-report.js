"use strict";
(function(root){
 function initialize({$,request,state,esc}){
  let data=null,kind='daily';
  const metrics=[['emailAdded','邮件累计新增'],['newSubscribers','邮件新增订阅人数'],['subscriptionRate','客户订阅率'],['buyers','邮件购买总人数'],['newBuyers','邮件新客户数'],['newConversion','邮件新客户转化率'],['returningBuyers','邮件回头客数'],['retention','邮件留存率〔自定义〕'],['emailSales','邮件渠道销售额']];
  const moneyKeys=['emailSales','emailNewSales','emailReturningSales','storeSales'];
  const ratioKeys=['subscriptionRate','newConversion','retention','emailSalesShare'];
  const fmt=(k,v)=>v==null?'—':ratioKeys.includes(k)?v.toFixed(2)+'%':moneyKeys.includes(k)?data.currency+' '+v.toFixed(2):v.toLocaleString('en-US');
  const range=r=>r.start+(r.start===r.end?'':' ～ '+r.end)+(!r.complete?' · 未完周':'');
  function detail(){
   const r=data?.[kind]?.find(x=>x.start+'_'+x.end===$('crm-breakdown-period').value);
   if(!r)return;
   $('crm-email-breakdown').innerHTML='<thead><tr><th>平台</th><th>邮件活动</th><th>成交类型</th><th>去重客户</th><th>订单数</th><th>销售额</th></tr></thead><tbody>'+(r.breakdown?.length?r.breakdown.map(x=>'<tr><td>'+esc(x.platform)+'</td><td>'+esc(x.campaign)+'</td><td>'+esc(x.customerType==='new'?'首次购买':x.customerType==='returning'?'再次购买':'待核验')+'</td><td>'+x.buyers+'</td><td>'+x.orders+'</td><td>'+esc(fmt('emailSales',x.sales))+'</td></tr>').join(''):'<tr><td colspan="6">该周期没有已核验邮件归因订单；请同时查看数据覆盖说明。</td></tr>')+'</tbody>';
  }
  function render(){
   if(!data)return;
   const rows=[...data[kind]].reverse();
   $('crm-report-status').textContent='更新：'+new Date(data.generatedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})+'（北京） · 统计时区：'+data.timezone+' · 截至 '+data.through+' · 邮件点击7天归因';
   const columns=[...metrics,['emailNewSales','邮件首购销售额'],['emailReturningSales','邮件复购销售额']];
   const bounds=['buyers','newBuyers','returningBuyers','emailSales','emailNewSales','emailReturningSales'];
   $('crm-report-table').innerHTML='<thead><tr><th>统计周期</th>'+columns.map(([k,t])=>'<th title="'+esc(data.definitions[k]||'')+'">'+t+'</th>').join('')+'<th>归因覆盖</th></tr></thead><tbody>'+rows.map(r=>'<tr><td style="white-space:nowrap">'+esc(range(r))+'</td>'+columns.map(([k])=>'<td>'+(!r.attributionCoverage?.complete&&bounds.includes(k)&&r[k]!=null?'≥ ':'')+esc(fmt(k,r[k]))+'</td>').join('')+'<td>'+esc(r.attributionCoverage?.complete?'已记录访问内完整':'仅已核验部分')+'</td></tr>').join('')+'</tbody>';
   $('crm-report-notes').textContent=data.notes.join(' ');
   const p=data.currentPopulation;
   $('crm-population-current').textContent=p?'当前客户池订阅率：'+fmt('subscriptionRate',p.subscriptionRate)+' · 已订阅 '+p.subscribedPopulation+' / 有效邮箱 '+p.validEmailPopulation+' · 快照 '+new Date(p.asOf).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})+' · '+p.scope:'当前客户池订阅数据暂不可用';
   const selected=$('crm-breakdown-period').value;
   $('crm-breakdown-period').innerHTML=rows.map(r=>'<option value="'+r.start+'_'+r.end+'">'+esc(range(r))+'</option>').join('');
   if(rows.some(r=>r.start+'_'+r.end===selected))$('crm-breakdown-period').value=selected;
   const refs=[['storeSales','全店销售额'],['storeBuyers','全店购买人数'],['storeNewBuyers','全店新客户'],['storeReturningBuyers','全店回头客'],['emailSalesShare','邮件销售占比'],['emailVisitors','邮件去重访客']];
   $('crm-store-reference').innerHTML='<thead><tr><th>周期</th>'+refs.map(([,t])=>'<th>'+t+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr><td>'+esc(range(r))+'</td>'+refs.map(([k])=>'<td>'+(!r.attributionCoverage?.complete&&k==='emailSalesShare'&&r[k]!=null?'≥ ':'')+esc(fmt(k,r[k]))+'</td>').join('')+'</tr>').join('')+'</tbody>';
   detail();
  }
  async function refresh(force=false){
   if(!state.token)return;
   $('crm-report-status').textContent=force?'正在核验7天邮件访问与成交，新老客按订单判断…':'正在读取CRM / EDM报表…';
   $('crm-report-refresh').disabled=true;
   try{const r=await request('/api/bi-crm-report',force?{refresh:'1'}:{});data=r.data;render();if(r.stale)$('crm-report-status').textContent+=' · 更新失败或数据过期';}
   catch(e){$('crm-report-status').textContent='报表读取失败：'+e.message;}
   finally{$('crm-report-refresh').disabled=false;}
  }
  $('crm-report-kind').onchange=e=>{kind=e.target.value;render()};
  $('crm-breakdown-period').onchange=detail;
  $('crm-report-refresh').onclick=()=>refresh(true);
  $('crm-report-download').onclick=async()=>{
   try{const r=await fetch('/api/bi-crm-report?format=csv&kind='+kind,{headers:{Authorization:'Bearer '+state.token},cache:'no-store'});if(!r.ok||!r.headers.get('content-type')?.includes('text/csv'))throw Error('导出失败');const u=URL.createObjectURL(await r.blob());const a=document.createElement('a');a.href=u;a.download='Kailash_CRM_EDM_'+kind+'.csv';a.click();URL.revokeObjectURL(u);}
   catch(e){$('crm-report-status').textContent=e.message;}
  };
  return {refresh};
 }
 root.KBICRMPeriodReport={initialize};
})(typeof window!=='undefined'?window:globalThis);
