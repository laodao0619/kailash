"use strict";
(function(root){
const COLORS={HHH:"#229977",HHL:"#67b69b",HLH:"#82be6d",HLL:"#b5d68a",LHH:"#dcb56c",LHL:"#e6a25f",LLH:"#d57e69",LLL:"#c46b72"};
const MAP={HHH:"重要价值用户",HHL:"重要保持用户",HLH:"重要发展用户",HLL:"一般发展用户",
 LHH:"重要挽留用户",LHL:"一般挽留用户",LLH:"一般价值用户",LLL:"一般保持用户"};
function initialize({$,request,state,esc,n}){
 let current=null,compare=null,selected=null,rot=.58,pitch=-.44,scale=1;
 let cells=[],drag=null,latestVersion=0;
 const canvas=$("rfm-cube"),ctx=canvas.getContext("2d");
 function scope(){return {tier:$("rfm-tier").value,aov:$("rfm-aov").value,
 thresholds:{recencyDays:Number($("rfm-r").value),frequencyOrders:Number($("rfm-f").value),monetaryUsd:Number($("rfm-m").value)}}}
 function filters(){const f=scope();return {tier:f.tier,aov:f.aov,r:f.thresholds.recencyDays,f:f.thresholds.frequencyOrders,m:f.thresholds.monetaryUsd}}
 function stat(label,value){return '<div class="module-stat"><small>'+esc(label)+'</small><strong>'+esc(value)+'</strong></div>'}
 function projection(x,y,z){
  // Isometric 3D projection with adjustable yaw and tilt.
  const yaw=Math.cos(rot)*x-Math.sin(rot)*z;
  const depth=Math.sin(rot)*x+Math.cos(rot)*z;
  const yy=Math.cos(pitch)*y-Math.sin(pitch)*depth;
  const dz=Math.sin(pitch)*y+Math.cos(pitch)*depth;
  const k=140*scale/(1+dz*.07);
  return {x:450+yaw*k,y:285-yy*k,z:dz};
 }
 const V=(x,y,z)=>projection(x-1,y-1,z-1);
 function polygon(points,color,alpha=.6){
  ctx.beginPath();ctx.moveTo(points[0].x,points[0].y);
  for(let j=1;j<points.length;j++)ctx.lineTo(points[j].x,points[j].y);
  ctx.closePath();ctx.fillStyle=color;ctx.globalAlpha=alpha;ctx.fill();
  ctx.strokeStyle=color;ctx.lineWidth=1.2;ctx.globalAlpha=Math.min(1,alpha+.25);ctx.stroke();
  ctx.globalAlpha=1;
 }
 function colorAlpha(hex,alpha){const s=hex.replace("#","");return "rgba("+parseInt(s.slice(0,2),16)+","+parseInt(s.slice(2,4),16)+","+parseInt(s.slice(4,6),16)+","+alpha+")"}
 function pointInPoly(x,y,poly){
  let inside=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){
   const a=poly[i],b=poly[j];
   if((a.y>y)!==(b.y>y)&&x<(b.x-a.x)*(y-a.y)/(b.y-a.y)+a.x)inside=!inside;
  }return inside;
 }
 const FACE_DEFS=[
  {ids:[0,2,6,4],normal:[-1,0,0],shade:.70},
  {ids:[1,5,7,3],normal:[1,0,0],shade:.86},
  {ids:[0,4,5,1],normal:[0,-1,0],shade:.67},
  {ids:[2,3,7,6],normal:[0,1,0],shade:1.12},
  {ids:[0,1,3,2],normal:[0,0,-1],shade:.82},
  {ids:[4,6,7,5],normal:[0,0,1],shade:.94}
 ];
 function normalDepth(n){return Math.cos(pitch)*(Math.sin(rot)*n[0]+Math.cos(rot)*n[2])+Math.sin(pitch)*n[1]}
 function shadeColor(hex,factor){const c=hex.slice(1);return '#'+[0,2,4].map(i=>Math.min(255,Math.round(parseInt(c.slice(i,i+2),16)*factor)).toString(16).padStart(2,'0')).join('')}
 function line(a,b,color,width=1,dashed=false){
  ctx.save();ctx.strokeStyle=color;ctx.lineWidth=width;ctx.setLineDash(dashed?[5,5]:[]);
  ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();ctx.restore();
 }
 function badge(text,x,y,color='#24455d'){
  ctx.save();ctx.font='600 13px system-ui';const width=ctx.measureText(text).width+18;
  const xx=Math.max(7,Math.min(893-width,x-width/2)),yy=Math.max(7,Math.min(566,y));
  ctx.fillStyle='rgba(255,255,255,.96)';ctx.fillRect(xx,yy,width,25);
  ctx.strokeStyle='#d7e1e8';ctx.strokeRect(xx,yy,width,25);ctx.fillStyle=color;
  ctx.textAlign='center';ctx.fillText(text,xx+width/2,yy+17);ctx.restore();
 }
 function render(){
  if(!ctx)return;
  ctx.clearRect(0,0,900,600);
  // An opaque floor and depth-correct faces remove the reversible wireframe illusion.
  const floor=[V(0,0,0),V(2.18,0,0),V(2.18,0,2.18),V(0,0,2.18)];
  polygon(floor,'#e9eff4',1);
  for(let i=0;i<=4;i++){
   const t=i*.52;line(V(t,0,0),V(t,0,2.08),'#d6e0e8');line(V(0,0,t),V(2.08,0,t),'#d6e0e8');
  }
  const bounds=[[0,0,0],[2.08,0,0],[0,2.08,0],[2.08,2.08,0],[0,0,2.08],[2.08,0,2.08],[0,2.08,2.08],[2.08,2.08,2.08]].map(p=>V(...p));
  const visible=FACE_DEFS.filter(f=>normalDepth(f.normal)<-1e-6);
  const edges=[[0,1],[0,2],[0,4],[1,3],[1,5],[2,3],[2,6],[3,7],[4,5],[4,6],[5,7],[6,7]];
  for(const [a,b] of edges){const front=visible.some(f=>f.ids.includes(a)&&f.ids.includes(b));line(bounds[a],bounds[b],front?'#8fa5b6':'#cbd7e1',front?1.6:1,!front);}
  const origin=V(0,0,0),axes=[{name:'R+ 更近期',end:V(2.42,0,0),color:'#2676b6'},{name:'F+ 次数增多',end:V(0,0,2.42),color:'#c27b2e'},{name:'M+ 消费增加',end:V(0,2.42,0),color:'#795ab6'}];
  for(const a of axes){
   line(origin,a.end,a.color,2.7);
   const angle=Math.atan2(a.end.y-origin.y,a.end.x-origin.x);
   polygon([a.end,{x:a.end.x-12*Math.cos(angle-.38),y:a.end.y-12*Math.sin(angle-.38)},{x:a.end.x-12*Math.cos(angle+.38),y:a.end.y-12*Math.sin(angle+.38)}],a.color,1);
  }
  cells=[];const faces=[];
  const max=Math.max(1,...(current?.segments||[]).map(s=>s.count));
  for(const seg of current?.segments||[]){
   const hi=c=>c==='H'?1:0;
   const x=hi(seg.code[0]),z=hi(seg.code[1]),y=hi(seg.code[2]);
   const ratio=seg.count/max;
   const w=seg.count?(.13+.84*Math.cbrt(ratio)):.08;
   const pad=(1.04-w)/2,start=[x*1.04+pad,y*1.04+pad,z*1.04+pad];
   const c=(dx,dy,dz)=>V(start[0]+dx*w,start[1]+dy*w,start[2]+dz*w);
   const corners=[c(0,0,0),c(1,0,0),c(0,1,0),c(1,1,0),c(0,0,1),c(1,0,1),c(0,1,1),c(1,1,1)];
   const center=c(.5,.5,.5);
   cells.push({code:seg.code,center,seg,depth:center.z,corners});
   for(const face of visible){const poly=face.ids.map(i=>corners[i]);faces.push({code:seg.code,seg,poly,shade:face.shade,depth:poly.reduce((v,p)=>v+p.z,0)/4});}
  }
  faces.sort((a,b)=>b.depth-a.depth);
  for(const face of faces){
   const intensity=face.seg.count?(.68+.32*Math.sqrt(face.seg.count/max)):.35;
   polygon(face.poly,shadeColor(COLORS[face.code],face.shade*intensity),1);
   if(selected===face.code){ctx.save();ctx.strokeStyle='#132f45';ctx.lineWidth=3;ctx.beginPath();face.poly.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();ctx.stroke();ctx.restore();}
  }
  // Hit-test only actually visible, depth-sorted surfaces (nearest surface wins).
  cells=faces.map(f=>({code:f.code,poly:f.poly,depth:f.depth}));
  const labelCells=(current?.segments||[]).map(seg=>{
   const x=seg.code[0]==='H'?1:0,y=seg.code[2]==='H'?1:0,z=seg.code[1]==='H'?1:0;
   return {seg,p:V(x*1.04+.52,y*1.04+.52,z*1.04+.52)};
  }).sort((a,b)=>b.p.z-a.p.z);
  for(const {seg,p} of labelCells){
   const nearest=[...faces].reverse().find(f=>pointInPoly(p.x,p.y,f.poly));
   if(nearest&&nearest.code!==seg.code)continue;
   ctx.save();ctx.font='bold 12px system-ui';ctx.textAlign='center';
   const label=seg.code+' · '+seg.count,width=ctx.measureText(label).width+12;
   ctx.fillStyle='rgba(255,255,255,.94)';ctx.fillRect(p.x-width/2,p.y-16,width,33);
   ctx.fillStyle='#183448';ctx.fillText(label,p.x,p.y-3);ctx.font='11px system-ui';ctx.fillText(seg.pct+'%',p.x,p.y+11);ctx.restore();
  }
  for(const a of axes)badge(a.name,a.end.x+(a.end.y<85?90:0),Math.max(55,a.end.y+(a.end.y<origin.y?-31:9)),a.color);
  ctx.save();ctx.beginPath();ctx.arc(origin.x,origin.y,6,0,Math.PI*2);ctx.fillStyle='#fff';ctx.fill();ctx.lineWidth=2.5;ctx.strokeStyle='#183448';ctx.stroke();ctx.restore();
  badge('O (0, 0, 0) · 模型原点',origin.x,origin.y+12);
  const nearR=Math.sin(rot)<0?'R高值侧':'R低值侧',nearF=Math.cos(rot)<0?'F高值侧':'F低值侧';
  badge('靠近你：'+nearR+' / '+nearF,450,12);
  ctx.save();ctx.font='12px system-ui';ctx.fillStyle='#607b90';ctx.fillText('实线：可见边界  ·  虚线：后方边界',28,585);ctx.restore();
  const orientation=$('rfm-orientation');if(orientation)orientation.textContent='当前近侧：'+nearR+'、'+nearF+'；上方为M高值。';
 }
 function detail(code){
  selected=code;
  document.querySelectorAll("#rfm-8segments [data-rfm-code]").forEach(b=>b.classList.toggle("active",b.dataset.rfmCode===code));
  const seg=current?.segments?.find(s=>s.code===code);
  if(seg)$("rfm-segment-detail").textContent=seg.label+"（"+code+"）· "+seg.count+"位 · 已分类客户中的"+seg.pct+
   "% · 180天历史消费汇总 $"+seg.m180.toLocaleString()+"。R/F/M高低基于当前可调阈值，独立于按历史累计消费＋180天订单数计算的S+/S/A/B等级。";
  render();
 }
 function paint(){
  if(!current)return;
  $("rfm-health").innerHTML=stat("选中客户",n(current.totalSelected))+
   stat("已分类",n(current.classified))+
   stat("R高值健康度",current.health.rate===null?"数据不足":current.health.rate+"%")+
   stat("M/R/F缺失",n(current.unknown.count));
  $("rfm-8segments").innerHTML=current.segments.map(s=>'<button type="button" class="rfm-segment" data-rfm-code="'+s.code+'">'+
   '<i style="background:'+COLORS[s.code]+'"></i><div><b>'+esc(s.label)+'</b><br><span>'+s.code+' · '+n(s.count)+'位 / '+s.pct+'%</span></div></button>').join("");
  document.querySelectorAll("#rfm-8segments [data-rfm-code]").forEach(b=>b.onclick=()=>detail(b.dataset.rfmCode));
  if(!current.classified)$("rfm-segment-detail").textContent="当前筛选无完整的M/R/F客户，请检查阈值或切换到全部。";
  render();if(selected)detail(selected);
 }
 async function refresh(){
  if(!state.token)return;
  const version=++latestVersion;
  $("rfm-snapshot-status").textContent="正在读取当前RFM聚合…";
  try{
   const r=await request("/api/bi-rfm-cube",filters());
   if(version!==latestVersion)return;
   current=r;selected=null;paint();
   $("rfm-snapshot-status").textContent="更新于 "+new Date(r.asOf).toLocaleString("zh-CN")+" · 历史快照，待净额核验";
  }catch(e){$("rfm-snapshot-status").textContent="模型读取失败："+e.message;}
 }
 async function savedList(){
  try{
   const d=await request("/api/bi-rfm-snapshots");
   $("rfm-snapshot-select").innerHTML='<option value="">选择已保存快照</option>'+
    d.snapshots.map(x=>'<option value="'+esc(x.id)+'">'+esc(x.label)+' · '+new Date(x.at).toLocaleDateString("zh-CN")+'</option>').join("");
  }catch(e){$("rfm-snapshot-status").textContent="快照列表暂不可用："+e.message}
 }
 async function save(){
  if(!current)return;
  const label=$("rfm-snapshot-name").value.trim()||new Date().toLocaleString("zh-CN")+" RFM模型";
  const id="rfm-"+Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,10);
  try{
   const response=await fetch("/api/bi-rfm-snapshots",{method:"POST",
    headers:{"Content-Type":"application/json",Authorization:"Bearer "+state.token},
    body:JSON.stringify({id,label,scope:current.scope,sourceAsOf:current.asOf})});
   const data=await response.json();
   if(!response.ok||!data.ok)throw Error(data.error||"保存失败");
   $("rfm-snapshot-status").textContent="已保存："+label;await savedList();
  }catch(e){$("rfm-snapshot-status").textContent="保存失败："+(e.message==="stale_source_refresh_required"?"客户数据刚刚更新，请先点击更新模型再保存":e.message)}
 }
 async function compareWithSaved(){
  const id=$("rfm-snapshot-select").value;if(!id||!current)return;
  try{
   const d=await request("/api/bi-rfm-snapshots",{id});compare=d.snapshot;
   if(compare.summary?.tierPolicyVersion!==current.tierPolicyVersion){$("rfm-comparison").hidden=false;$("rfm-comparison").textContent="该历史快照采用旧版客户分层口径，请保存新规则基线后再对比。";return;}
   const baseline=compare.summary;
   const same=JSON.stringify(baseline.scope)===JSON.stringify(current.scope);
   const head='<strong>保存的模型：'+esc(compare.label)+'</strong> · '+esc(new Date(compare.at).toLocaleString("zh-CN"))+
    '<p class="muted">基线分类 '+baseline.classified+'人，当前 '+current.classified+
    '人；R高值占比 '+(baseline.health.rate===null?"无数据":baseline.health.rate+"%")+
    ' → '+(current.health.rate===null?"无数据":current.health.rate+"%")+'</p>';
   const warn=same?'<p class="muted">同口径比较八类客户结构，数值来自各次保存的聚合快照。</p>':
    '<p class="warn">注意：筛选条件或R/F/M阈值不同。以下差异仅供探索，不可作为健康度变化结论。</p>';
   const table='<div class="rfm-compare-table"><div><b>细分群体</b><b>基线</b><b>当前</b><b>占比变化</b></div>'+
    current.segments.map(seg=>{
     const old=baseline.segments.find(x=>x.code===seg.code)||{count:0,pct:0};
     const delta=seg.pct-old.pct;
     const display=(delta>0?"+":"")+delta.toFixed(2)+"pp";
     return '<div><span><i style="background:'+COLORS[seg.code]+'"></i>'+esc(seg.label)+'</span>'+
      '<span>'+old.count+' / '+old.pct+'%</span><span>'+seg.count+' / '+seg.pct+'%</span>'+
      '<span style="color:'+(delta>=0?"#367457":"#b47162")+'">'+display+'</span></div>';
    }).join("")+'</div>';
   $("rfm-comparison").hidden=false;$("rfm-comparison").innerHTML=head+warn+table;
  }catch(e){$("rfm-comparison").hidden=false;$("rfm-comparison").textContent="对比读取失败："+e.message}
 }
 const pointer=(e)=>{
  const rect=canvas.getBoundingClientRect();
  return {x:(e.clientX-rect.left)/rect.width*900,y:(e.clientY-rect.top)/rect.height*600};
 };
 canvas.addEventListener("pointerdown",e=>{drag={x:e.clientX,y:e.clientY,moved:false};canvas.setPointerCapture(e.pointerId)});
 canvas.addEventListener("pointermove",e=>{if(!drag)return;
  const dx=e.clientX-drag.x,dy=e.clientY-drag.y;
  if(Math.abs(dx)+Math.abs(dy)>3)drag.moved=true;
  rot+=dx*.008;pitch=Math.max(-1.05,Math.min(-.20,pitch-dy*.008));drag.x=e.clientX;drag.y=e.clientY;render();
 });
 canvas.addEventListener("pointerup",e=>{const moved=drag?.moved;drag=null;
  if(moved)return;const p=pointer(e);
  const found=[...cells].reverse().find(c=>pointInPoly(p.x,p.y,c.poly));
  if(found)detail(found.code);
 });
 canvas.addEventListener("wheel",e=>{e.preventDefault();scale=Math.max(.65,Math.min(1.25,scale*(e.deltaY>0?.92:1.08)));render()},{passive:false});
 // Apply filter changes immediately; numeric thresholds are debounced while typing.
 let changeTimer=null;
 for(const id of ["rfm-tier","rfm-aov"]){$(id).onchange=()=>refresh()}
 for(const id of ["rfm-r","rfm-f","rfm-m"]){
  $(id).addEventListener("input",()=>{
   clearTimeout(changeTimer);
   changeTimer=setTimeout(()=>{
    if([$("rfm-r"),$("rfm-f"),$("rfm-m")].every(x=>x.checkValidity()&&x.value.trim()))refresh();
   },430);
  });
 }
 if($('rfm-back-view'))$('rfm-back-view').onclick=()=>{rot=.58+Math.PI;pitch=-.44;scale=1;render()};
 $("rfm-reset-view").onclick=()=>{rot=.58;pitch=-.44;scale=1;render()};
 $("rfm-run").onclick=refresh;$("rfm-save").onclick=save;$("rfm-compare").onclick=compareWithSaved;
 $("rfm-copy").onclick=()=>{
  if(!current)return;
  const value=["RFM模型："+new Date(current.asOf).toLocaleString("zh-CN"),
   "分类人数："+current.classified,"健康度："+current.health.rate+"%",
   "缺失："+current.unknown.count,...current.segments.map(s=>s.label+"："+s.count+"位 ("+s.pct+"%)")].join("\n");
  navigator.clipboard?.writeText(value).then(()=>{$("rfm-snapshot-status").textContent="统计已复制"}).catch(()=>{
   $("rfm-snapshot-status").textContent="浏览器不允许复制，请使用保存快照。";
  });
 };
 return {refresh,savedList,source:()=>current};
}
root.KBIRFM3D={initialize};
})(typeof window!=="undefined"?window:globalThis);
