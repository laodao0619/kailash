"use strict";
(function(root){
 function initialize(ctx){
  const {$,request,state,load,esc,n,money,fmt,safeUrl}=ctx;
  const mod={summary:null,casePage:1,casePageCount:1,caseBusy:false};
  const cube=root.KBIRFM3D?.initialize(ctx)||null;
  const ops=root.KBIOpsCenter?.initialize(ctx)||null;
  const go=id=>$(id)?.scrollIntoView({behavior:"smooth",block:"start"});
  function stat(label,value,note){
   return '<div class="module-stat"><small>'+esc(label)+'</small><strong>'+esc(value)+'</strong><em>'+esc(note)+'</em></div>';
  }
  async function summary(){
   if(!state.token)return;
   $("rfm-summary-cards").textContent="正在计算既有CRM历史汇总…";
   try{
    const d=await request("/api/bi-workbench-summary");
    mod.summary=d;
    $("rfm-summary-cards").innerHTML=[
     stat("当前已索引CRM客户",n(d.masterTotal),"历史客户索引"),
     stat("近30天有购买记录",n(d.customerActivity.recent30),"基于历史R值"),
     stat("近180天消费汇总",money(d.historical.m180.value),"覆盖 "+n(d.historical.m180.coverage)+"位 · 待审计"),
     stat("已标记CRM等级",n(d.tierTotal),"新规则暂算分布")
    ].join("");
    const colors={"S+":"#315d49","S":"#548368","A":"#719982","B":"#95b09f",
     "基础客户":"#b7c8bc","沉睡":"#d3b68e","从未购买":"#c8d5cc","待核验":"#9aa5aa"};
    const max=Math.max(1,...d.tiers.map(t=>t.count));
    $("rfm-bars").innerHTML=d.tiers.map((t,i)=>'<button type="button" class="rfm-bar" data-tier="'+i+'">'+
     '<strong>'+esc(t.name)+'</strong><span class="meter"><i style="width:'+
     (t.count/max*100).toFixed(2)+'%;background:'+(colors[t.name]||"#789980")+'"></i></span>'+
     '<span>'+n(t.count)+' · '+t.share+'%</span></button>').join("");
    document.querySelectorAll("#rfm-bars [data-tier]").forEach(b=>b.onclick=()=>{
     const tier=d.tiers[Number(b.dataset.tier)]?.name;
     if(!tier)return;
     $("tier").value=tier;state.page=1;load();go("customers");
    });
    $("rfm-coverage").textContent="更新时间："+fmt(d.generatedAt)+" · 180天净消费有数据 "+
     n(d.historical.m180.coverage)+"/"+n(d.masterTotal)+"位 · 历史累计消费有数据 "+
     n(d.historical.lifetime.coverage)+"/"+n(d.masterTotal)+"位。当前等级来自既有快照，正式全历史净额尚待核验。";
    const subscriptions=d.subscriptions.slice(0,8).map(x=>x.name+" "+n(x.count)).join(" / ");
    const countries=d.topCountries.slice(0,8).map(x=>x.name+" "+n(x.count)).join(" / ");
    $("report-content").innerHTML='<div class="module-kpis">'+
     stat("客户索引",n(d.masterTotal),"历史有效CRM记录")+
     stat("历史客户累计消费",money(d.historical.lifetime.value),"历史快照，覆盖"+n(d.historical.lifetime.coverage)+"位")+
     stat("180天有效订单",n(d.historical.f180.value),"历史快照，覆盖"+n(d.historical.f180.coverage)+"位")+
     stat("近90天有购买记录",n(d.customerActivity.recent90),"历史R值")+
     '</div><h3>邮件订阅结构</h3><p class="muted">'+esc(subscriptions||"暂无")+
     '</p><h3>客户国家分布</h3><p class="muted">'+esc(countries||"暂无")+
     '</p><h3>高低客单价客户（$400 独立维度）</h3><p class="muted">历史平均客单价 ≥ $400：'+n(d.aovBands.high)+
     '位 · ＜ $400：'+n(d.aovBands.low)+'位 · 缺少可计算客单价：'+n(d.aovBands.unknown)+
     '位。该分组不影响S+/S/A/B等级。</p><div class="warn">收入、利润与ROAS不使用缺少广告成本及退款审计的数据进行估算。本报表数值来自现有CRM快照。</div>';
   }catch(e){
    $("rfm-summary-cards").textContent="RFM读取失败："+e.message;
    $("report-content").textContent="报表暂不可用："+e.message;
   }
  }
  async function cases(){
   if(!state.token||mod.caseBusy)return;
   mod.caseBusy=true;
   $("case-rows").innerHTML='<tr><td colspan="6" class="empty-state">正在读取已归档Case…</td></tr>';
   try{
    const d=await request("/api/bi-workbench-cases",{
     q:$("case-query").value,priority:$("case-priority").value,page:mod.casePage
    });
    mod.casePageCount=d.pageCount;
    $("case-count").textContent="匹配 "+n(d.total)+"件";
    $("case-page-label").textContent="第"+d.page+" / "+Math.max(1,d.pageCount)+"页 · 最多扫描500条归档事件";
    $("case-prev").disabled=d.page<=1;$("case-next").disabled=d.page>=d.pageCount;
    $("case-rows").innerHTML=d.cases.length?d.cases.map(x=>{
     const email=x.customerEmail||x.emails?.[0]||"";
     const customer=x.customerName||email||"未识别客户";
     const source=safeUrl(x.originalUrl)||"";
     return '<tr><td><b>'+esc(customer)+'</b><div class="fine">'+esc(email)+'</div></td>'+
      '<td>'+esc(x.category||"待分类")+'<div class="fine">'+esc((x.summary||"").slice(0,100))+'</div></td>'+
      '<td><span class="pill">'+esc(x.priority||"待核验")+'</span></td>'+
      '<td>'+esc(x.replyStatus||"待核实")+'<div class="fine">'+esc(x.nextAction||"")+'</div></td>'+
      '<td>'+fmt(x.receivedAt)+'</td><td>'+
      (source?'<a href="'+esc(source)+'" target="_blank" rel="noopener noreferrer" style="color:#367252;text-decoration:underline">原始邮件</a>':"无源链接")+
      '<div><button type="button" class="case-customer" data-email="'+esc(email)+'">查看客户</button></div></td></tr>';
    }).join(""):'<tr><td colspan="6" class="empty-state">本次扫描范围内没有匹配Case，不代表没有未解决问题。</td></tr>';
    document.querySelectorAll(".case-customer").forEach(b=>b.onclick=()=>{
     if(!b.dataset.email)return;
     $("q").value=b.dataset.email;state.page=1;load();go("customers");
    });
   }catch(e){
    $("case-rows").innerHTML='<tr><td colspan="6" class="empty-state">客服Case暂不可用：'+esc(e.message)+'</td></tr>';
   }finally{mod.caseBusy=false;}
  }
  async function products(){
   if(!state.token)return;
   $("catalog-status").textContent="正在读取Shopify商品目录…";
   try{
    const d=await request("/api/bi-workbench-products",{q:$("product-search").value.trim()});
    $("catalog-status").textContent="展示最近更新的"+d.products.length+"款在售商品。"+
     (d.hasMore?"还有其他商品，可用搜索缩小范围。":"")+"当前目录不代表销量排名。";
    $("catalog-grid").innerHTML=d.products.length?d.products.map(p=>{
     const url=safeUrl(p.url,"product"),image=safeUrl(p.image,"image");
     return '<article class="product-card">'+(image?'<img loading="lazy" alt="'+esc(p.title)+'" src="'+esc(image)+'">':
      '<div class="status">暂无商品图</div>')+'<div class="product-info"><b>'+esc(p.title)+'</b>'+
      '<p>'+esc(p.productType||"未分类")+'</p><p>当前起售价：'+
      esc(p.price?money(Number(p.price.amount),p.price.currencyCode):"未记录")+'</p>'+
      (url?'<a href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">查看网站商品</a>':"网站链接未提供")+
      '</div></article>';
    }).join(""):'<div class="muted">没有匹配的在售商品。</div>';
   }catch(e){$("catalog-status").textContent="商品目录暂不可用："+e.message;}
  }
  async function health(){
   try{
    const h=await request("/api/bi-index-health",{},false),q=h.productionQA?.checks||{};
    const item=(label,value,status)=>'<div class="health-item"><small>'+esc(label)+
     '</small><strong>'+esc(value)+'</strong><small>'+esc(status)+'</small></div>';
    $("system-health").innerHTML=[
     item("CRM客户索引",h.ready?n(h.snapshot?.total)+" 条":"构建中",h.ready?"已可查询":"尚未就绪"),
     item("列表筛选与排序",q.list&&q.sort&&q.tier?"通过":"待核验","真实数据测试"),
     item("Customer 360°",q.customer360?"通过":"待核验","客户订单及来信"),
     item("商品与邮件摘要",q.productHistory&&q.mailSummary?"通过":"待核验","服务端读取"),
     item("客户备注",q.noteRead?"读取通过":"待读取验收","写入仍需用户端核验"),
     item("正式全历史净额","待财务核验","RFM当前显示历史快照")
    ].join("");
   }catch(e){$("system-health").textContent="状态暂不可读取："+e.message;}
  }
  $("case-refresh").onclick=cases;
  $("case-search").onclick=()=>{mod.casePage=1;cases()};
  $("case-query").onkeydown=e=>{if(e.key==="Enter"){$("case-search").click()}};
  $("case-priority").onchange=()=>{mod.casePage=1;cases()};
  $("case-prev").onclick=()=>{if(mod.casePage>1){mod.casePage--;cases()}};
  $("case-next").onclick=()=>{if(mod.casePage<mod.casePageCount){mod.casePage++;cases()}};
  $("product-search-btn").onclick=products;
  $("product-search").onkeydown=e=>{if(e.key==="Enter")products()};
  $("report-refresh").onclick=summary;
  $("report-export").onclick=()=>{$("export").click();};
  $("marketing-find").onclick=()=>{const q=$("marketing-customer").value.trim();if(!q)return;$("q").value=q;state.page=1;load();go("customers")};
  $("marketing-customer").onkeydown=e=>{if(e.key==="Enter")$("marketing-find").click()};
  // Auto-refresh the existing history snapshot after back-end syncs; do not
  // rerun Shopify ingestion. Pause network polling on hidden tabs.
  let lastSummary=0;
  const originalSummary=summary;
  const scheduledSummary=async()=>{await originalSummary();lastSummary=Date.now()};
  setInterval(()=>{if(document.visibilityState==="visible"&&state.token)scheduledSummary()},5*60*1000);
  document.addEventListener("visibilitychange",()=>{
   if(document.visibilityState==="visible"&&state.token&&Date.now()-lastSummary>5*60*1000)scheduledSummary();
  });
  $("report-rfm").onclick=()=>go("rfm");
  $("report-cases").onclick=()=>go("case-center");
  const start=()=>Promise.allSettled([scheduledSummary(),cases(),products(),health(),
    cube?.refresh?.(),cube?.savedList?.(),ops?.start?.()]);
  setInterval(()=>{if(state.token&&document.visibilityState==="visible")cube?.refresh?.()},5*60*1000);
  return {start,summary:scheduledSummary,cases,products,health,rfm:cube,ops};
 }
 root.KBIWorkbenchModules={initialize};
})(typeof window!=="undefined"?window:globalThis);
