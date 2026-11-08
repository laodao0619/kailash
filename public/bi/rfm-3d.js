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
  const k=165*scale/(1+dz*.07);
  return {x:450+yaw*k,y:290-yy*k,z:dz};
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
 function render(){
  if(!ctx)return;
  ctx.clearRect(0,0,900,600);
  ctx.font="13px -apple-system,system-ui,sans-serif";
  ctx.fillStyle="#6b8575";ctx.fillText("R (最近购买)",28,35);
  ctx.fillText("M (近180天消费)",28,57);ctx.fillText("F (购买频率)",28,79);
  const bounds=[[0,0,0],[2,0,0],[0,2,0],[0,0,2],[2,2,0],[2,0,2],[0,2,2],[2,2,2]].map(p=>V(...p));
  const lines=[[0,1],[0,2],[0,3],[1,4],[1,5],[2,4],[2,6],[3,5],[3,6],[4,7],[5,7],[6,7]];
  ctx.strokeStyle="#d3ded6";ctx.lineWidth=1;
  for(const [a,b] of lines){ctx.beginPath();ctx.moveTo(bounds[a].x,bounds[a].y);ctx.lineTo(bounds[b].x,bounds[b].y);ctx.stroke()}
  cells=[];
  const max=Math.max(1,...(current?.segments||[]).map(s=>s.count));
  for(const seg of current?.segments||[]){
   // Axis coding: R high -> +x, F high -> +z, M high -> +y.
   const hi=(c)=>c==="H"?1:0;
   const x=hi(seg.code[0]),z=hi(seg.code[1]),y=hi(seg.code[2]);
   const start=[x*1.04-.03,y*1.04-.03,z*1.04-.03],w=.95;
   const c=(dx,dy,dz)=>V(start[0]+dx*w,start[1]+dy*w,start[2]+dz*w);
   const corners=[c(0,0,0),c(1,0,0),c(0,1,0),c(1,1,0),c(0,0,1),c(1,0,1),c(0,1,1),c(1,1,1)];
   const center=c(.5,.5,.5),poly=[corners[0],corners[1],corners[3],corners[7],corners[6],corners[4]];
   const intensity=seg.count?(.13+.68*Math.sqrt(seg.count/max)):.06;
   cells.push({code:seg.code,poly,center,seg,depth:center.z,intensity,corners});
  }
  cells.sort((a,b)=>b.depth-a.depth);
  for(const item of cells){
   const {corners,seg}=item,color=COLORS[seg.code];
   const a=item.intensity*(selected===seg.code?1.2:1);
   polygon([corners[0],corners[1],corners[3],corners[2]],color,a*.6);
   polygon([corners[4],corners[5],corners[7],corners[6]],color,a*.78);
   polygon([corners[2],corners[3],corners[7],corners[6]],color,a*.9);
   polygon([corners[1],corners[5],corners[7],corners[3]],color,a*.75);
   // Deterministic particle cloud: darker/denser = more clients. Never show exact PII.
   const particles=Math.min(145,Math.round(4+Math.sqrt(seg.count)*2.0));
   for(let k=0;k<particles;k++){
    const seed=(k*17+seg.code.charCodeAt(0)*13)%991;
    const fx=(seed*73%997)/997,fy=(seed*137%983)/983,fz=(seed*311%977)/977;
    const x=seg.code[0]==="H"?1:0,y=seg.code[2]==="H"?1:0,z=seg.code[1]==="H"?1:0;
    const p=V(x*1.04+fx*.90,y*1.04+fy*.90,z*1.04+fz*.90);
    ctx.beginPath();ctx.arc(p.x,p.y,seg.count?1.7:0,0,Math.PI*2);
    ctx.fillStyle=colorAlpha(color,.35+.55*Math.sqrt(seg.count/max));ctx.fill();
   }
   ctx.fillStyle="#1d4031";ctx.font="bold 12px system-ui";
   ctx.textAlign="center";ctx.fillText(seg.code+" "+seg.count,item.center.x,item.center.y-4);
   ctx.font="11px system-ui";ctx.fillText(seg.pct+"%",item.center.x,item.center.y+11);
   ctx.textAlign="left";
  }
  const labels=[["R+",V(2.25,.15,.2)],["F+",V(.1,.15,2.25)],["M+",V(.1,2.25,.1)]];
  ctx.font="bold 15px system-ui";ctx.fillStyle="#34694d";
  for(const [v,p] of labels)ctx.fillText(v,p.x,p.y);
 }
 function detail(code){
  selected=code;
  document.querySelectorAll("#rfm-8segments [data-rfm-code]").forEach(b=>b.classList.toggle("active",b.dataset.rfmCode===code));
  const seg=current?.segments?.find(s=>s.code===code);
  if(seg)$("rfm-segment-detail").textContent=seg.label+"（"+code+"）· "+seg.count+"位 · 已分类客户中的"+seg.pct+
   "% · 180天历史消费汇总 $"+seg.m180.toLocaleString()+"。R/F/M高低基于当前可调阈值，并非客户S/A/B等级。";
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
    body:JSON.stringify({id,label,scope:current.scope})});
   const data=await response.json();
   if(!response.ok||!data.ok)throw Error(data.error||"保存失败");
   $("rfm-snapshot-status").textContent="已保存："+label;await savedList();
  }catch(e){$("rfm-snapshot-status").textContent="保存失败："+e.message}
 }
 async function compareWithSaved(){
  const id=$("rfm-snapshot-select").value;if(!id||!current)return;
  try{
   const d=await request("/api/bi-rfm-snapshots",{id});compare=d.snapshot;
   const s=compare.summary;
   const equal=JSON.stringify(s.scope)===JSON.stringify(current.scope);
   $("rfm-comparison").hidden=false;
   $("rfm-comparison").textContent="基线「"+compare.label+"」："+s.classified+"人，R高值健康度 "+
    (s.health.rate===null?"未知":s.health.rate+"%")+"；当前："+current.classified+"人，"+
    (current.health.rate===null?"未知":current.health.rate+"%")+
    (equal&&s.health.rate!==null&&current.health.rate!==null?
     "；变化 "+(current.health.rate-s.health.rate).toFixed(2)+" 个百分点":
     "。两次筛选或阈值不同，禁止直接解读健康度变化。");
  }catch(e){$("rfm-comparison").textContent="对比读取失败："+e.message}
 }
 const pointer=(e)=>{
  const rect=canvas.getBoundingClientRect();
  return {x:(e.clientX-rect.left)/rect.width*900,y:(e.clientY-rect.top)/rect.height*600};
 };
 canvas.addEventListener("pointerdown",e=>{drag={x:e.clientX,y:e.clientY,moved:false};canvas.setPointerCapture(e.pointerId)});
 canvas.addEventListener("pointermove",e=>{if(!drag)return;
  const dx=e.clientX-drag.x,dy=e.clientY-drag.y;
  if(Math.abs(dx)+Math.abs(dy)>3)drag.moved=true;
  rot+=dx*.008;pitch=Math.max(-1.35,Math.min(.45,pitch-dy*.008));drag.x=e.clientX;drag.y=e.clientY;render();
 });
 canvas.addEventListener("pointerup",e=>{const moved=drag?.moved;drag=null;
  if(moved)return;const p=pointer(e);
  const found=[...cells].reverse().find(c=>pointInPoly(p.x,p.y,c.poly));
  if(found)detail(found.code);
 });
 canvas.addEventListener("wheel",e=>{e.preventDefault();scale=Math.max(.55,Math.min(1.6,scale*(e.deltaY>0?.92:1.08)));render()},{passive:false});
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
