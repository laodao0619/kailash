"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const {build,emailSource,queryBatch}=require("../lib/kbi-ops-analytics");
const {matches,eligible}=require("../lib/kbi-audience");
const {validPlan}=require("../api/bi-marketing-plans");
const Q=rows=>({parseErrors:[],tableData:{columns:[],rows}});
const fixture={
 sales:Q([{day:"2026-11-01",total_sales:"1000",net_sales:"900",gross_sales:"1100",orders:"5",average_order_value:"180"}]),
 summary:Q([{total_sales:"1000",net_sales:"900",orders:"5",average_order_value:"180",returning_customer_rate:"0.4",returning_customers:"2"}]),
 sessions:Q([{day:"2026-11-01",sessions:"200",conversion_rate:"0.025"}]),
 channels:Q([{sales_channel:"Online Store",total_sales:"600",net_sales:"550",orders:"3"},
 {sales_channel:"Shop",total_sales:"400",net_sales:"350",orders:"2"}]),
 repeat:Q([{new_or_returning_customer:"New",total_sales:"700",orders:"3"},
 {new_or_returning_customer:"Returning",total_sales:"300",orders:"2"}]),
 attribution:Q([{referring_channel:"facebook",total_sales__last_click:"900",orders__last_click:"4"}]),
 campaigns:Q([{utm_campaign:"blessing_email",utm_source:"shopify_email",total_sales__last_click:"110",orders__last_click:"1"},
 {utm_campaign:"ad",utm_source:"facebook",total_sales__last_click:"550",orders__last_click:"3"}]),
 products:Q([{product_title:"Vajra Necklace",net_sales:"500",orders:"2"}]),
 categories:Q([{product_type:"Tibetan Thokcha",net_sales:"600",orders:"4"}])
};
test("ShopifyQL sales/visits computes session-weighted conversion and native repeat customer rate",()=>{
 const d=build(fixture,"2026-11-08T00:00:00Z");
 assert.equal(d.metrics.gmv,1000);
 assert.equal(d.metrics.netSales,900);
 assert.equal(d.metrics.sessions,200);
 assert.equal(d.metrics.conversionRate,2.5);
 assert.equal(d.metrics.aov,180);
 assert.equal(d.metrics.repeatCustomerRate,40);
 assert.equal(d.metrics.returningGmvShare,30);
 assert.equal(d.metrics.returningOrderShare,40);
 assert.equal(d.channelSales.reduce((s,c)=>s+c.share,0),100);
 assert.equal(d.emailCampaigns.length,1);
 assert.equal(d.metrics.emailAttributedGmv,110);
 assert.equal(d.topProducts[0].name,"Vajra Necklace");
 assert(queryBatch().includes("LAST_CLICK_ATTRIBUTION"));
});
test("ShopifyQL parse errors reject instead of silently substituting fake metrics",()=>{
 assert.throws(()=>build({...fixture,sessions:{parseErrors:["bad"],tableData:null}}),/shopifyql_sessions_invalid/);
 assert.equal(emailSource("email"),true);
 assert.equal(emailSource("facebook"),false);
});
const customer=(id,subscription="SUBSCRIBED",tier="A",m=900)=>({id:String(id),email:"c"+id+"@gmail.com",
 subscription,tier,m180:m,f180:3,rDays:30,aov:220,country:"US",quality:"有效"});
test("audience excludes unsubscribed, bot, QQ and invalid customers",()=>{
 const rows=[customer(100001),customer(100002,"NOT_SUBSCRIBED"),customer(100003),
 {...customer(100004),email:"foo@qq.com"},{...customer(100005),quality:"机器人"}];
 const d=matches(rows,{tier:"A"});
 assert.equal(d.ids.length,2);
 assert.equal(d.counts.excluded.consent,1);
 assert.equal(d.counts.excluded.quality,2);
 assert.equal(eligible(customer(100002,"NOT_SUBSCRIBED")),false);
});
test("audiences select HHH independent of S+ customer grade",()=>{
 const rows=[customer(100001,"SUBSCRIBED","B",4000),customer(100002,"SUBSCRIBED","S+",4000)];
 const d=matches(rows,{rfm:"HHH",tier:"B",aov:"all",r:90,f:2,m:800});
 assert.deepEqual(d.ids,["100001"]);
});
test("calendar validates scheduled time and metadata",()=>{
 const plan={id:"plan-abcdef123",title:"Kailash Brand Month",subject:"A Blessing",preview:"For loved ones",
  scheduledAt:"2026-11-16T01:00:00.000Z",status:"planned",audienceId:"",utmCampaign:"kailash_brand_month",notes:""};
 assert.equal(validPlan(plan),true);
 assert.equal(validPlan({...plan,scheduledAt:"invalid"}),false);
 assert.equal(validPlan({...plan,utmCampaign:"bad space"}),false);
});
test("landing dashboard has actionable live operations/calendar/audience UIs",()=>{
 const html=fs.readFileSync(path.join(__dirname,"../public/bi/index.html"),"utf8");
 const js=fs.readFileSync(path.join(__dirname,"../public/bi/ops-center.js"),"utf8");
 for(const id of ["ops-gmv","ops-net","ops-cvr","ops-aov","ops-return-share","ops-repeat-rate",
  "ops-email-gmv","ops-channel-bars","ops-trend-chart","ops-email-campaigns",
  "calendar-save","calendar-subject","calendar-preview","calendar-audience",
  "audience-preview","audience-save","audience-saved-list","audience-sync-status"]){
  assert(html.includes('id="'+id+'"'),id);
 }
 assert(js.includes('"/api/bi-ops-dashboard"'));
 assert(js.includes('"/api/bi-marketing-plans"'));
 assert(js.includes('"/api/bi-audiences"'));
 assert(js.includes('"/api/bi-audience-sync"'));
 assert(html.includes('"/bi/ops-center.js"'));
});
