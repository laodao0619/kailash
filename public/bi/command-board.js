"use strict";
(function(root){
function initialize(ctx){
 const {$,request,state,esc,money}=ctx;
 let board={version:0,items:[]},busy=false,editing=null,latest=null;
 async function mutate(action,item){
  if(busy)return;busy=true;render();
  try{
   const r=await fetch('/api/bi-ops-board',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+state.token},body:JSON.stringify({action,expectedVersion:board.version,...(action==='save'?{item}:{id:item.id})})});
   const d=await r.json();if(!r.ok||!d.ok)throw Error(d.error);
   board=d;editing=null;$('board-title').value='';$('board-notes').value='';render();if(latest)suggestions(latest);$('board-status').textContent='已保存到云端';
  }catch(e){$('board-status').textContent=e.message==='board_version_changed'?'其他人已更新，请重新读取后再保存。当前输入仍保留。':'保存失败，请重试';}
  finally{busy=false;render();}
 }
 function render(){
  for(const kind of ['goal','opportunity','anomaly']){
   const rows=board.items.filter(x=>x.kind===kind).sort((a,b)=>Number(a.done)-Number(b.done)||Number(b.priority)-Number(a.priority));
   $('board-'+kind).innerHTML=rows.length?rows.map(x=>'<article class="command-item '+(x.done?'completed ':'')+(x.priority?'is-priority':'')+'" data-id="'+esc(x.id)+'"><div class="row"><label class="command-check"><input type="checkbox" class="board-done" '+(x.done?'checked':'')+(busy?' disabled':'')+' aria-label="完成 '+esc(x.title)+'"><b>'+esc(x.title)+'</b></label><button class="board-priority" aria-pressed="'+x.priority+'" '+(busy?'disabled':'')+' aria-label="重点标注 '+esc(x.title)+'">'+(x.priority?'★ 重点':'☆ 标重点')+'</button></div><p class="command-note">'+esc(x.notes||'暂无备注')+'</p><div class="toolbar"><button class="board-edit">编辑 / 备注</button><button class="board-delete" '+(busy?'disabled':'')+'>移除</button></div></article>').join(''):'<p class="muted">暂无'+({goal:'目标',opportunity:'机会点',anomaly:'异常点'}[kind])+'，可手动新增或从数据建议加入。</p>';
  }
  document.querySelectorAll('.command-item').forEach(el=>{
   const item=board.items.find(x=>x.id===el.dataset.id);
   el.querySelector('.board-done').onchange=e=>mutate('save',{...item,done:e.target.checked});
   el.querySelector('.board-priority').onclick=()=>mutate('save',{...item,priority:!item.priority});
   el.querySelector('.board-delete').onclick=()=>mutate('delete',item);
   el.querySelector('.board-edit').onclick=()=>{editing=item.id;$('board-kind').value=item.kind;$('board-title').value=item.title;$('board-notes').value=item.notes;$('board-editor').scrollIntoView({behavior:'smooth',block:'center'});};
  });
 }
 async function load(){
  if(!state.token)return;
  try{board=await request('/api/bi-ops-board');render();if(latest)suggestions(latest);$('board-status').textContent='已读取云端目标与事项';}
  catch(_){$('board-status').textContent='目标与事项暂不可用，请重新读取';}
 }
 function suggestions(d){
  latest=d;const m=d.metrics||{},rows=[];
  if(m.reachedCheckoutSessions>0&&m.convertedSessions!=null){const completion=m.convertedSessions/m.reachedCheckoutSessions*100;
   rows.push({kind:'anomaly',title:'核查结账流失',notes:'所选期间 '+(d.range?d.range.start+' 至 '+d.range.end:'云端快照')+'：进入结账 '+m.reachedCheckoutSessions+' 次会话，完成购买 '+m.convertedSessions+' 次，完成比例 '+completion.toFixed(1)+'%。这是待排查项，尚不能确认支付故障。'});}
  const top=d.topProducts?.[0];if(top)rows.push({kind:'opportunity',title:'评估热销品补货与素材扩展',notes:top.name+'，所选期间净销售额 '+money(top.netSales)+'。结合库存、毛利及投放成本后决定是否加码。'});
  if(m.emailAttributedGmv>0)rows.push({kind:'opportunity',title:'复盘邮件贡献并安排下一轮触达',notes:'所选期间邮件最后点击归因 GMV '+money(m.emailAttributedGmv)+'。结合飞书排期和订阅受众复盘，不等于邮件发送日志。'});
  $('board-suggestions').innerHTML=rows.map((x,i)=>'<div class="suggestion"><div><span class="pill">'+(x.kind==='anomaly'?'待排查':'机会建议')+'</span><b>'+esc(x.title)+'</b><p class="muted">'+esc(x.notes)+'</p></div><button data-suggestion="'+i+'" '+(board.items.some(y=>y.title===x.title)?'disabled':'')+'>加入跟进</button></div>').join('');
  document.querySelectorAll('[data-suggestion]').forEach(b=>b.onclick=async()=>{await mutate('save',{...rows[Number(b.dataset.suggestion)],id:'item-'+Date.now().toString(36),done:false,priority:false});suggestions(latest);});
 }
 $('board-save').onclick=()=>{
  const title=$('board-title').value.trim();if(!title){$('board-status').textContent='请填写目标或事项';return;}
  const old=board.items.find(x=>x.id===editing);
  mutate('save',{id:editing||'item-'+Date.now().toString(36),kind:$('board-kind').value,title,notes:$('board-notes').value,done:old?.done||false,priority:old?.priority||false});
 };
 $('board-new').onclick=()=>{editing=null;$('board-title').value='';$('board-notes').value='';};
 $('board-reload').onclick=load;
 function cell(v){
  if(v==null)return '';
  if(Array.isArray(v))return v.map(cell).join(' ');
  if(typeof v==='object')return String(v.text||v.name||v.link||'');
  if(typeof v==='number'&&v>1e12&&v<4e12)return new Date(v).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'});
  return String(v);
 }
 async function loadSource(){
  $('email-source-status').textContent='正在读取飞书排期…';
  try{
   const d=await request('/api/bi-email-source');
   const names=(d.fields||[]).map(f=>f.name||f.field_name).filter(Boolean);
   $('email-source-table').innerHTML='<table><thead><tr>'+names.map(n=>'<th>'+esc(n)+'</th>').join('')+'</tr></thead><tbody>'+d.records.map(r=>'<tr>'+names.map(n=>'<td>'+esc(cell(r.fields?.[n]))+'</td>').join('')+'</tr>').join('')+'</tbody></table>';
   $('email-source-status').textContent=(d.cached?'已核对飞书快照 · 实时连接暂不可用 · ':'飞书实时原始排期 · ')+d.records.length+' 条 · '+(d.partial?'部分记录 · ':'')+'读取于 '+new Date(d.readAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})+'。本区为只读来源，下面的BI计划独立保存。';
  }catch(_){$('email-source-status').textContent='暂时无法读取飞书排期。可点击原表查看；需要飞书应用拥有该表的读取权限。';}
 }
 $('email-source-refresh').onclick=loadSource;
 return {start:()=>Promise.allSettled([load(),loadSource()]),suggestions};
}
root.KBICommandBoard={initialize};
})(typeof window!=='undefined'?window:globalThis);
