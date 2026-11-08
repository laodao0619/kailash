"use strict";
(function(root){
function initialize(ctx){
 const {$,request,state,esc,n,money}=ctx;
 const op={data:null,calendar:{version:0,plans:[]},audiences:{version:0,audiences:[]},
  editingId:null,preview:null,selectedAudience:null,syncStopped:false,syncBusy:false};
 const cash=v=>v==null?"—":money(v);
 const pct=v=>v==null?"—":Number(v).toFixed(2)+"%";
 const fmtDate=iso=>iso?new Date(iso).toLocaleString("zh-CN",{timeZone:"Asia/Shanghai",hour12:false}):"—";
 const beijingInput=iso=>iso?new Date(new Date(iso).getTime()+8*3600000).toISOString().slice(0,16):"";
 function rowBar(name,value,max,unit,color="#4a8a6a"){
  const ratio=max>0?Math.max(0,Math.min(100,value/max*100)):0;
  return '<div class="ops-bar-row"><div class="ops-bar-header"><span>'+esc(name)+'</span><b>'+esc(unit)+'</b></div>'+
   '<div class="ops-bar-track"><i style="width:'+ratio.toFixed(1)+'%;background:'+color+'"></i></div></div>';
 }
 function chart(){
  const svg=$("ops-trend-chart"),d=op.data?.daily||[];
  const checked=[...document.querySelectorAll("#ops-trend-metrics input:checked")].map(x=>x.value);
  if(!d.length||!checked.length){svg.innerHTML='<text x="20" y="45" fill="#839287">没有选择指标或近期没有数据。</text>';return}
  const lane=87,left=86,right=17,top=15,bottom=38,width=870,height=top+lane*checked.length+bottom;
  svg.setAttribute("viewBox","0 0 "+width+" "+height);
  const keys={gmv:{key:"totalSales",label:"GMV",color:"#307455",suffix:"$"},
   orders:{key:"orders",label:"订单量",color:"#bb8751",suffix:""},
   cvr:{key:"conversionRate",label:"转化率",color:"#6c7baf",suffix:"%"}};
  let out='';
  for(let k=0;k<checked.length;k++){
   const metric=keys[checked[k]],y0=top+lane*k,bottomY=y0+57;
   const rows=d.filter(x=>x[metric.key]!=null);
   const max=Math.max(1,...rows.map(x=>metric.key==="conversionRate"?x[metric.key]*100:x[metric.key]));
   out+='<text x="8" y="'+(y0+18)+'" fill="#496351" font-size="12" font-weight="600">'+metric.label+'</text>';
   out+='<text x="'+(left-10)+'" y="'+(y0+12)+'" text-anchor="end" font-size="10" fill="#839589">'+(metric.key==="conversionRate"?(max.toFixed(1)+"%"):max.toFixed(0))+'</text>';
   out+='<line x1="'+left+'" y1="'+bottomY+'" x2="'+(width-right)+'" y2="'+bottomY+'" stroke="#e6ede7"/>';
   if(rows.length){
    const poly=rows.map(x=>{
     const dayIndex=d.findIndex(z=>z.day===x.day);
     const xx=left+dayIndex/Math.max(1,d.length-1)*(width-left-right);
     const v=metric.key==="conversionRate"?x[metric.key]*100:x[metric.key];
     return {day:x.day,x:xx,y:bottomY-v/max*45,value:v};
    });
    out+='<path fill="none" stroke="'+metric.color+'" stroke-width="2.4" stroke-linejoin="round" d="'+
     poly.map((p,i)=>(i?"L":"M")+p.x.toFixed(1)+" "+p.y.toFixed(1)).join(" ")+'"/>';
    for(const p of poly){
     out+='<circle cx="'+p.x.toFixed(1)+'" cy="'+p.y.toFixed(1)+'" r="3.3" fill="'+metric.color+'"><title>'+
      esc(p.day+" · "+metric.label+" "+p.value.toFixed(2)+metric.suffix)+'</title></circle>';
    }
   }
   for(let t=0;t<5;t++){
    const i=Math.round(t*(d.length-1)/4),xx=left+i/Math.max(1,d.length-1)*(width-left-right);
    out+='<text x="'+xx.toFixed(1)+'" y="'+(bottomY+19)+'" text-anchor="middle" fill="#85968a" font-size="10">'+esc(d[i]?.day?.slice(5)||"")+'</text>';
   }
  }
  svg.innerHTML=out;
 }
 function viewAnalytics(d){
  if(!d)return;
  op.data=d;
  const m=d.metrics||{};
  const map={["ops-gmv"]:cash(m.gmv),["ops-net"]:cash(m.netSales),["ops-cvr"]:pct(m.conversionRate),
   ["ops-aov"]:cash(m.aov),["ops-return-share"]:pct(m.returningGmvShare),
   ["ops-repeat-rate"]:pct(m.repeatCustomerRate),["ops-email-gmv"]:cash(m.emailAttributedGmv),
   ["ops-sessions"]:n(m.sessions)};
  for(const [id,value] of Object.entries(map))$(id).textContent=value;
  $("funnel-sessions").textContent=n(m.sessions);
  $("funnel-atc").textContent=n(m.addedToCartSessions);
  $("funnel-checkout").textContent=n(m.reachedCheckoutSessions);
  $("funnel-paid").textContent=n(m.convertedSessions);
  $("funnel-atc-rate").textContent=pct(m.addedToCartRate)+" / 会话";
  $("funnel-checkout-rate").textContent=pct(m.reachedCheckoutRate)+" / 会话";
  $("funnel-paid-rate").textContent=pct(m.conversionRate)+" / 会话";
  const checkoutCompletion=m.reachedCheckoutRate>0?m.conversionRate/m.reachedCheckoutRate*100:null;
  $("ops-funnel-insight").textContent="每100次访问约 "+(m.addedToCartRate??0).toFixed(2)+
   "次加购、"+(m.reachedCheckoutRate??0).toFixed(2)+"次进入结账、"+
   (m.conversionRate??0).toFixed(2)+"次完成购买；"+
   (checkoutCompletion===null?"当前没有足够的结账样本。":
    "进入结账后的会话购买完成比例约 "+checkoutCompletion.toFixed(1)+"%。")+
   " 建议先按国家、广告来源与移动设备核查流量质量，再检查移动端商品页、物流承诺和结账支付体验。";
  const historic=d.daily.slice(0,-1);
  const recent7=historic.slice(-7),prior7=historic.slice(-14,-7);
  const gmv7=recent7.reduce((v,x)=>v+x.totalSales,0);
  const gmvBefore=prior7.reduce((v,x)=>v+x.totalSales,0);
  const change=gmvBefore>0?(gmv7/gmvBefore-1)*100:null;
  const sourceSummary=change===null?"暂无完整可比的前7日数据":
   "最近7个完整报告日GMV "+cash(gmv7)+"，较此前7日 "+(change>=0?"+":"")+change.toFixed(1)+"%";
  const emailShare=m.gmv>0?m.emailAttributedGmv/m.gmv*100:null;
  $("ops-executive-brief").textContent=sourceSummary+
   "。30日店铺转化率 "+pct(m.conversionRate)+
   "；邮件最后点击归因收入占同期GMV "+pct(emailShare)+
   "。优先按渠道与设备检查低质量流量，并复查商品页到结账的漏斗损失。";
  $("ops-data-state").textContent="Shopify Analytics · "+fmtDate(d.generatedAt);
  const channels=d.channelSales||[],max=Math.max(1,...channels.map(x=>x.gmv));
  $("ops-channel-bars").innerHTML=channels.slice(0,8).map((c,i)=>
   rowBar(c.name,c.gmv,max,cash(c.gmv)+" · "+c.share+"%",i===0?"#357454":"#8baa95")).join("")||
   '<p class="muted">没有可分类的销售渠道。</p>';
  $("ops-customer-mix").textContent="新客GMV "+cash(m.newGmv)+" · 老客GMV "+cash(m.returningGmv)+
   "；老客订单占比 "+pct(m.returningOrderShare)+"。复购客户率采用Shopify原生指标，与老客订单占比不是同一口径。";
  const attrs=d.touchAttribution||[];
  $("ops-attribution").innerHTML=attrs.slice(0,8).map(x=>
   '<div class="ops-list-item row"><span>'+esc(x.name)+'</span><b>'+cash(x.gmv)+'</b></div>').join("")+
   '<p class="muted">按Shopify最后点击归因；归因渠道和销售渠道分开统计。</p>';
  const emails=d.emailCampaigns||[];
  $("ops-email-campaigns").innerHTML=emails.length?emails.slice(0,8).map(x=>
   '<div class="ops-list-item"><div class="row"><b>'+esc(x.campaign)+'</b><b>'+cash(x.attributedGmv)+'</b></div>'+
   '<p class="muted">'+esc(x.source)+' · '+n(x.attributedOrders)+'笔归因订单</p></div>').join(""):
   '<p class="muted">近期没有匹配的Email UTM归因记录。不能据此断言邮件没有产生销售。</p>';
  $("ops-product-winners").innerHTML=(d.topProducts||[]).slice(0,6).map((x,i)=>
   '<div class="ops-list-item row"><span>'+(i+1)+'. '+esc(x.name)+'</span><b>'+cash(x.netSales)+'</b></div>').join("");
  $("ops-category-winners").innerHTML=(d.productCategories||[]).slice(0,5).map(x=>
   '<div class="ops-list-item row"><span>'+esc(x.name)+'</span><b>'+cash(x.netSales)+'</b></div>').join("");
  chart();listCalendar();
 }
 async function analytics(){
  if(!state.token)return;
  $("ops-data-state").textContent="正在读取Shopify指标…";
  try{
   const result=await request("/api/bi-ops-dashboard");
   if(!result.data)throw Error("empty_shopify_analytics");
   viewAnalytics(result.data);
   if(result.stale)$("ops-data-state").textContent+=" · 云端快照待更新";
  }catch(e){$("ops-data-state").textContent="Shopify指标暂不可用："+e.message}
 }
 function allAudiences(){
  const saved=op.audiences.audiences||[];
  $("calendar-audience").innerHTML='<option value="">全体已订阅客户（发送前再核验）</option>'+
   saved.map(a=>'<option value="'+esc(a.id)+'">'+esc(a.name)+' · '+a.previewCount+'位</option>').join("");
  $("audience-saved-list").innerHTML=saved.length?saved.map(a=>
   '<div class="audience-card" data-aud="'+esc(a.id)+'">'+
   '<div class="row"><b>'+esc(a.name)+'</b><span class="pill">'+n(a.previewCount)+'位</span></div>'+
   '<p class="muted">RFM：'+esc(a.criteria.rfm||"全部")+' · CRM：'+esc(a.criteria.tier||"全部")+
   ' · AOV：'+esc(a.criteria.aov)+' · 已订阅有效客户</p>'+
   '<div class="toolbar"><button type="button" class="aud-sync" data-id="'+esc(a.id)+'">预览并回传Shopify</button></div></div>').join(""):
   '<p class="muted">尚未保存客户分组。设置RFM或客户等级条件后预览并保存。</p>';
  document.querySelectorAll(".aud-sync").forEach(b=>b.onclick=()=>syncAudience(b.dataset.id));
 }
 async function loadAudiences(){
  try{
   const d=await request("/api/bi-audiences");
   op.audiences=d;allAudiences();
  }catch(e){$("audience-preview-result").textContent="分组列表读取失败："+e.message}
 }
 function audienceCriteria(){
  return {rfm:$("audience-rfm").value,tier:$("audience-tier").value,aov:$("audience-aov").value,
   country:$("audience-country").value.trim(),
   minM:$("audience-minM").value,maxR:$("audience-maxR").value,
   r:90,f:2,m:800};
 }
 async function audiencePreview(){
  try{
   const d=await request("/api/bi-audiences",{preview:"1",...audienceCriteria()});
   op.preview=d;
   $("audience-preview-result").textContent="符合营销订阅与筛选条件："+n(d.counts.matched)+"位；"+
    "已排除未订阅 "+n(d.counts.excluded.consent)+"位、无效客户 "+n(d.counts.excluded.quality)+
    "位、RFM字段不足 "+n(d.counts.excluded.rfm)+"位。数据源 "+fmtDate(d.sourceAsOf);
  }catch(e){$("audience-preview-result").textContent="预览失败："+e.message}
 }
 async function post(path,body){
  const response=await fetch(path,{method:"POST",cache:"no-store",headers:{
   "Content-Type":"application/json",Authorization:"Bearer "+state.token},
   body:JSON.stringify(body)});
  const data=await response.json().catch(()=>({}));
  if(!response.ok||!data.ok)throw Error(data.error||"request_failed");
  return data;
 }
 async function saveAudience(){
  const name=$("audience-name").value.trim();
  if(name.length<2){$("audience-preview-result").textContent="请先填写客户分组名称。";return;}
  if(!op.preview||JSON.stringify(op.preview.criteria)!==JSON.stringify({
   ...op.preview.criteria,...audienceCriteria(),consentOnly:true
  })){await audiencePreview();}
  if(!op.preview?.sourceAsOf)return;
  const id="aud-"+Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,10);
  try{
   const d=await post("/api/bi-audiences",{action:"create",id,name,criteria:audienceCriteria(),
    sourceAsOf:op.preview.sourceAsOf,expectedVersion:op.audiences.version});
   op.audiences=d;allAudiences();
   $("audience-preview-result").textContent="分组已保存："+name+"。回传Shopify需额外点击确认。";
  }catch(e){$("audience-preview-result").textContent="保存失败："+e.message}
 }
 async function syncAudience(id){
  if(op.syncBusy)return;
  op.syncBusy=true;op.syncStopped=false;
  const saved=op.audiences.audiences.find(x=>x.id===id);
  if(!saved){op.syncBusy=false;return;}
  const status=$("audience-sync-status");
  try{
   let preview=await request("/api/bi-audience-sync",{id});
   const text="确认把「"+saved.name+"」匹配到的 "+preview.preview.count+
    "位已订阅客户按批次写入Shopify客户标签，并新建Shopify Segment？这不会发送邮件，也不会自动移除原有客户标签。";
   if(!window.confirm(text)){status.textContent="已取消，Shopify客户未开始本次更新。";return;}
   status.innerHTML="正在回传 <b>"+esc(saved.name)+"</b> · <button id='aud-stop'>停止后续批次</button>";
   $("aud-stop").onclick=()=>{op.syncStopped=true;status.textContent="正在停止后续批次；已完成的标签不会撤销。";};
   let completed=false;
   for(let i=0;i<100&&!op.syncStopped;i++){
    const d=await post("/api/bi-audience-sync?id="+encodeURIComponent(id),{
     confirm:"CONFIRM_SHOPIFY_AUDIENCE_SYNC",sourceAsOf:preview.preview.sourceAsOf
    });
    completed=d.status==="complete";
    status.innerHTML="Shopify回传："+n(d.position)+" / "+n(d.total)+
     "位 · "+(completed?"完成":"正在继续")+" · <button id='aud-stop'>停止后续批次</button>";
    $("aud-stop").onclick=()=>{op.syncStopped=true;};
    if(completed)break;
    await new Promise(resolve=>setTimeout(resolve,240));
   }
   if(!completed)status.textContent="本轮已暂停或达到安全批次上限，可再次点击分组回传按钮继续。";
   else status.textContent="Shopify客户标签回传完成；已建立对应客户Segment。请到Shopify客户分组核对人数。";
  }catch(e){status.textContent="回传失败："+e.message+"。已完成部分仍保留；检查权限与进度后重试。";}
  finally{op.syncBusy=false;}
 }
 function listCalendar(){
  const all=(op.calendar.plans||[]).slice().sort((a,b)=>Date.parse(a.scheduledAt)-Date.parse(b.scheduledAt));
  const campaigns=op.data?.emailCampaigns||[];
  $("email-calendar-list").innerHTML=all.length?all.map(p=>{
   const match=campaigns.filter(x=>p.utmCampaign&&x.campaign.toLowerCase()===p.utmCampaign.toLowerCase());
   const gmv=match.reduce((v,x)=>v+x.attributedGmv,0);
   const orders=match.reduce((v,x)=>v+x.attributedOrders,0);
   const audience=op.audiences.audiences.find(x=>x.id===p.audienceId);
   return '<div class="email-plan-card'+(op.editingId===p.id?" selected":"")+'">'+
    '<div class="row"><small class="muted">'+esc(fmtDate(p.scheduledAt))+'</small><span class="pill">'+esc(p.status)+'</span></div>'+
    '<h3>'+esc(p.title)+'</h3><p class="muted">'+esc(p.subject||"尚未填写邮件标题")+'</p>'+
    '<p class="meta">受众：'+esc(audience?.name||"全体已订阅客户")+' · UTM：'+esc(p.utmCampaign||"未设置")+'</p>'+
    '<div class="row"><b>归因GMV '+(match.length?cash(gmv):"暂无匹配UTM")+'</b>'+
    '<button class="plan-edit" data-plan-id="'+esc(p.id)+'">编辑</button></div>'+
    (match.length?'<p class="muted">最后点击归因 '+n(orders)+'笔订单</p>':"")+'</div>';
  }).join(""):'<p class="muted">尚无邮件排期。可新建Kailash Day of Giving或日常CRM邮件计划。</p>';
  document.querySelectorAll(".plan-edit").forEach(b=>b.onclick=()=>editCalendar(b.dataset.planId));
  $("calendar-status").textContent=all.length+"个计划 · 归因收入只关联UTM完全匹配的已记录活动，不代表邮件实际发送成功。";
 }
 async function loadCalendar(){
  try{const d=await request("/api/bi-marketing-plans");op.calendar=d;listCalendar();}
  catch(e){$("calendar-status").textContent="排期读取失败："+e.message}
 }
 function editCalendar(id){
  const p=op.calendar.plans.find(x=>x.id===id);
  if(!p)return;op.editingId=p.id;
  $("calendar-form-title").textContent="编辑："+p.title;
  $("calendar-title").value=p.title;$("calendar-date").value=beijingInput(p.scheduledAt);
  $("calendar-audience").value=p.audienceId||"";$("calendar-subject").value=p.subject;
  $("calendar-preview").value=p.preview;$("calendar-utm").value=p.utmCampaign;
  $("calendar-state").value=p.status;$("calendar-notes").value=p.notes;
  listCalendar();$("email-calendar-editor").scrollIntoView({behavior:"smooth",block:"center"});
 }
 function resetCalendar(){
  op.editingId=null;
  $("calendar-form-title").textContent="创建 / 编辑邮件计划";
  for(const id of ["calendar-title","calendar-date","calendar-subject","calendar-preview","calendar-utm","calendar-notes"])$(id).value="";
  $("calendar-audience").value="";$("calendar-state").value="draft";listCalendar();
 }
 async function saveCalendar(){
  const local=$("calendar-date").value;
  const date=local?new Date(local+"+08:00"):null;
  const title=$("calendar-title").value.trim(),subject=$("calendar-subject").value.trim(),
   preview=$("calendar-preview").value.trim();
  if(!date||Number.isNaN(date.getTime())||!title||!subject||!preview){
   $("calendar-form-note").textContent="请填写计划名称、北京时间排期、Subject及Preview后保存。";return;
  }
  const plan={id:op.editingId||"plan-"+Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,9),
   title,scheduledAt:date.toISOString(),audienceId:$("calendar-audience").value,
   subject,preview,utmCampaign:$("calendar-utm").value.trim(),
   status:$("calendar-state").value,notes:$("calendar-notes").value.trim()};
  try{
   const d=await post("/api/bi-marketing-plans",{action:"save",plan,expectedVersion:op.calendar.version});
   op.calendar=d;op.editingId=plan.id;listCalendar();
   $("calendar-form-note").textContent="已保存于私有云端 · "+fmtDate(new Date().toISOString())+"。不自动发送邮件。";
  }catch(e){$("calendar-form-note").textContent="保存失败："+e.message+"。请刷新计划版本后再试。"}
 }
 async function deleteCalendar(){
  if(!op.editingId)return;
  if(!window.confirm("确认删除此邮件排期？不会撤回已经发送的外部邮件。"))return;
  try{
   const d=await post("/api/bi-marketing-plans",{action:"delete",id:op.editingId,expectedVersion:op.calendar.version});
   op.calendar=d;resetCalendar();$("calendar-form-note").textContent="已删除云端排期。";
  }catch(e){$("calendar-form-note").textContent="删除失败："+e.message;}
 }
 $("ops-refresh").onclick=analytics;
 $("ops-products-link").onclick=()=>document.getElementById("product-center")?.scrollIntoView({behavior:"smooth"});
 document.querySelectorAll("#ops-trend-metrics input").forEach(x=>x.onchange=chart);
 $("calendar-brand-template").onclick=()=>{
  resetCalendar();
  $("calendar-title").value="Kailash Day of Giving · 品牌月";
  $("calendar-subject").value="Kailash Day of Giving: A Blessing for You and Your Loved Ones";
  $("calendar-preview").value="Infinite Light · Compassion · Blessings · Sharing";
  $("calendar-utm").value="kailash_day_of_giving_2026";
  $("calendar-notes").value="品牌月邮件草稿模板：11月16日开始庆祝。请手动选择具体发送日期和受众，核实素材和客户订阅状态；本工具不会自动发送。";
  $("calendar-form-note").textContent="已载入草稿模板。发送时间为空，请人工确认日期后保存。";
  $("email-calendar-editor").scrollIntoView({behavior:"smooth",block:"center"});
 };
 $("calendar-new").onclick=resetCalendar;$("calendar-reset").onclick=resetCalendar;
 $("calendar-save").onclick=saveCalendar;$("calendar-delete").onclick=deleteCalendar;
 $("audience-preview").onclick=audiencePreview;$("audience-save").onclick=saveAudience;
 for(const id of ["audience-rfm","audience-tier","audience-aov","audience-country","audience-minM","audience-maxR"]){
  $(id).addEventListener("change",()=>{op.preview=null;});
 }
 return {start:()=>Promise.allSettled([analytics(),loadAudiences(),loadCalendar()]),
  analytics,loadCalendar,loadAudiences};
}
root.KBIOpsCenter={initialize};
})(typeof window!=="undefined"?window:globalThis);
