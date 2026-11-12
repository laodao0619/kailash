'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {fetchMeta,action}=require('../lib/meta-ads');const {fetchGoogle}=require('../lib/google-ads');const {refreshAds}=require('../lib/ads-refresh');const {alignedTimezone}=require('../lib/ads-common');
const range={start:'2026-11-10',end:'2026-11-10'},ok=data=>({ok:true,status:200,json:async()=>data});
const metaEnv={META_SYSTEM_USER_TOKEN:'test-only-placeholder',META_GRAPH_API_VERSION:'v21.0'};
test('Meta combines the two accounts exactly once, follows cursor pagination and does not double-count action aliases',async()=>{
 const calls=[];const mock=async(url,opts)=>{
  const u=new URL(url);calls.push(u);assert.equal(opts.headers.Authorization,'Bearer test-only-placeholder');assert(!u.searchParams.has('access_token'));
  if(!u.pathname.endsWith('/insights')&&!u.pathname.endsWith('/ads'))return ok({currency:'USD',timezone_name:'America/New_York',name:'account'});
  if(u.pathname.endsWith('/ads'))return ok({data:[{id:'ad1',created_time:'2026-11-01T00:00:00Z',creative:{object_story_spec:{link_data:{link:'https://kailashenergy.com/pages/ritual'}}}}]});
  const first=u.pathname.includes('810672167888307'),level=u.searchParams.get('level');
  const row={date_start:range.start,date_stop:range.end,account_id:first?'810672167888307':'1559163378893343',spend:'10.25',impressions:'100',clicks:'5',actions:[{action_type:'purchase',value:'2'},{action_type:'omni_purchase',value:'2'}],action_values:[{action_type:'purchase',value:'50'}],campaign_name:'Ritual 产品复线',ad_name:'108 style 编织 2026-11-01',ad_id:'ad1'};
  if(level==='account'&&first&&!u.searchParams.has('after'))return ok({data:[row],paging:{next:'https://malicious.example/should-not-be-followed',cursors:{after:'page2'}}});
  if(level==='account'&&first&&u.searchParams.has('after'))return ok({data:[]});
  return ok({data:[row]});
 };
 const r=await fetchMeta(range,{env:metaEnv,fetchImpl:mock});
 assert.equal(r.spend,20.5);assert.equal(r.purchases,4);assert.equal(r.revenue,100);assert.equal(r.roas,100/20.5);
 assert.equal(r.daily.length,1);assert.equal(r.daily[0].spend,20.5);assert.equal(r.byAccount.length,2);assert.equal(r.byCampaign.length,2);
 assert.equal(r.byAd[0].landingPages[0],'https://kailashenergy.com/pages/ritual');assert(r.byAd[0].naming.testPoints.includes('108_style_braided'));assert(calls.every(x=>x.host==='graph.facebook.com'&&x.pathname.includes('/v21.0/')));
 assert.equal(action([{action_type:'purchase',value:'0'},{action_type:'omni_purchase',value:'4'}],['purchase','omni_purchase']),0);
});
test('Meta account native days remain available while only EST-aligned accounts can aggregate',async()=>{
 assert(alignedTimezone('America/New_York',range));assert(!alignedTimezone('America/New_York',{start:'2026-07-01',end:'2026-07-02'}));assert(!alignedTimezone('Etc/GMT+4',range));
 await assert.rejects(fetchMeta(range,{env:metaEnv,fetchImpl:async()=>ok({currency:'EUR',timezone_name:'Asia/Hong_Kong'})}),/meta_currency_mismatch/);
 await assert.rejects(fetchMeta(range,{env:{...metaEnv,META_AD_ACCOUNT_IDS:'810672167888307'}}),/meta_account_scope_mismatch/);
});
test('Meta retains per-account native daily rows and withholds mixed-zone aggregate',async()=>{
 const mock=async url=>{
  const u=new URL(url),accountId=u.pathname.includes('810672167888307')?'810672167888307':'1559163378893343';
  if(u.pathname.endsWith('/insights'))return ok({data:[{account_id:accountId,date_start:range.start,date_stop:range.end,spend:'10',impressions:'100',clicks:'5',actions:[],action_values:[]}]});
  if(u.pathname.endsWith('/ads'))return ok({data:[]});
  return ok({id:accountId,name:'account',currency:'USD',timezone_name:accountId==='810672167888307'?'Etc/GMT+4':'America/Chicago'});
 };
 const r=await fetchMeta(range,{env:{...metaEnv,META_AD_ACCOUNT_IDS:'810672167888307,1559163378893343'},fetchImpl:mock});
 assert.equal(r.spend,null);assert.equal(r.revenue,null);assert.equal(r.timeZone,null);assert.equal(r.daily.length,0);
 assert.deepEqual(r.byAccount.map(x=>x.timeZone),['Etc/GMT+4','America/Chicago']);
 assert(r.byAccount.every(x=>x.daily.length===1&&x.daily[0].accountTimeZone===x.timeZone));
});
function ready(name){return {timeZone:/Google/i.test(name)?'Etc/GMT+4':'Etc/GMT+5',source:name,status:'ready',currency:'USD',stale:false,generatedAt:'2026-11-12T00:00:00Z',lastSuccessfulAt:'2026-11-12T00:00:00Z',range,spend:10,purchases:1,revenue:30,roas:3,daily:[]};}
test('source failure preserves same-range last good with original timestamp and cannot erase the healthy provider',async()=>{
 const db=new Map(),writes=[];const now=new Date('2026-11-12T01:00:00Z');
 db.set('kbi-operations/v3/ads/meta/2026-11-10_2026-11-10.json',ready('Meta Marketing API'));
 const result=await refreshAds(range,{force:true,now,read:async p=>db.get(p),write:async(p,d)=>{writes.push(p);db.set(p,d)},providers:{meta:async()=>{throw Error('meta_api_190')},google:async()=>ready('Google Ads API')}});
 assert.equal(result.meta.spend,10);assert.equal(result.meta.stale,true);assert.equal(result.meta.lastSuccessfulAt,'2026-11-12T00:00:00Z');assert.equal(result.google.status,'ready');assert.equal(writes.length,2);assert.equal(result.totalSpend,null);assert.equal(result.blendedRoas,null);
});
test('unapproved Google yields pending, not fake zeros; cached failures suppress repeated API attempts',async()=>{
 const db=new Map();let calls=0;
 const options={now:new Date('2026-11-12T01:00:00Z'),read:async p=>db.get(p),write:async(p,d)=>db.set(p,d),providers:{meta:async()=>{calls++;return ready('Meta Marketing API')},google:async()=>{calls++;throw Error('google_api_approval_pending')}}};
 const a=await refreshAds(range,options);assert.equal(a.google.status,'api_application_pending');assert.equal(a.google.spend,null);
 // Fresh fixture timestamp is older than TTL; use a fresh generatedAt for successful cache test.
 const metaKey='kbi-operations/v3/ads/meta/2026-11-10_2026-11-10.json';db.get(metaKey).generatedAt=options.now.toISOString();
 await refreshAds(range,options);assert.equal(calls,2);
});
test('provider checkpoint survives another provider still running',async()=>{
 let release;const writes=[];const gate=new Promise(r=>release=r);
 const job=refreshAds(range,{force:true,read:async()=>null,write:async(p,d)=>writes.push(p),providers:{meta:async()=>ready('Meta'),google:async()=>{await gate;return ready('Google')}}});
 await new Promise(r=>setImmediate(r));assert.equal(writes.length,1);assert(writes[0].includes('/meta/'));release();await job;assert.equal(writes.length,2);
});
const googleEnv={GOOGLE_ADS_ACCESS_APPROVED:'true',GOOGLE_ADS_CLIENT_ID:'test-id',GOOGLE_ADS_CLIENT_SECRET:'test-secret',GOOGLE_ADS_REFRESH_TOKEN:'test-refresh',GOOGLE_ADS_CUSTOMER_ID:'2670021803',GOOGLE_ADS_API_VERSION:'v26',GOOGLE_ADS_PURCHASE_ACTION_IDS:'44'};
test('Google separates cost from action-filtered purchases and preserves both timing columns',async()=>{
 const queries=[];const mock=async(url,o)=>{
  if(String(url).includes('oauth2'))return ok({access_token:'temporary-test'});
  assert.equal(o.headers['developer-token'],undefined);const q=JSON.parse(o.body).query;queries.push(q);
  if(q.includes('FROM customer'))return ok({results:[{customer:{id:'2670021803',currencyCode:'USD',timeZone:'Etc/GMT+4',manager:false}}]});
  if(q.includes('FROM conversion_action'))return ok({results:[{conversionAction:{id:'44',resourceName:'customers/2670021803/conversionActions/44',category:'PURCHASE',status:'ENABLED',primaryForGoal:true}},{conversionAction:{id:'99',category:'PAGE_VIEW'}}]});
  if(q.includes('cost_micros')){assert(!q.includes('conversion_action'));return ok({results:[{segments:{date:range.start},metrics:{costMicros:'25240000',impressions:'1000',clicks:'70'}}]});}
  assert(q.includes("segments.conversion_action IN ('customers/2670021803/conversionActions/44')"));assert(!q.includes('all_conversions'));
  return ok({results:[{segments:{date:range.start,conversionAction:'customers/2670021803/conversionActions/44'},metrics:{conversions:4,conversionsValue:200,conversionsByConversionDate:3,conversionsValueByConversionDate:150}}]});
 };
 const r=await fetchGoogle(range,{env:googleEnv,fetchImpl:mock});assert.equal(r.timeZone,'Etc/GMT+4');assert.equal(r.dateBasis,'account_native');assert.equal(r.addToCart,null);assert.equal(r.spend,25.24);assert.equal(r.purchases,4);assert.equal(r.purchasesByConversionDate,3);assert.equal(r.revenueByConversionDate,150);assert.equal(r.roas,200/25.24);
 const zero=await fetchGoogle(range,{env:googleEnv,fetchImpl:(url,o)=>String(url).includes('googleAds:search')&&JSON.parse(o.body).query.includes('metrics.conversions,')?ok({results:[]}):mock(url,o)});
 assert.equal(zero.spend,25.24);assert.equal(zero.purchases,0);assert.equal(zero.revenue,0);assert.equal(zero.addToCart,null);assert.equal(zero.checkout,null);
 await assert.rejects(fetchGoogle(range,{env:{...googleEnv,GOOGLE_ADS_PURCHASE_ACTION_IDS:''},fetchImpl:mock}),/unconfirmed/);
});
test('dashboard checkpoints Shopify before slow ads and retains Shopify fields when one source is unavailable',async()=>{
 const paths=['@vercel/blob','../lib/crm-shopify','../lib/kbi-ops-analytics','../lib/ads-refresh'];
 const saved=paths.map(p=>{require(p);return [require.resolve(p),require.cache[require.resolve(p)].exports]});
 const fixture={version:1,generatedAt:'2026-11-10T10:00:00Z',metrics:{gmv:123,orders:2},daily:[{day:range.start}],channelSales:[{name:'Shop'}]};
 const writes=[];let previous=null,failShopify=false,release;
 const gate=new Promise(r=>release=r);
 require.cache[require.resolve('@vercel/blob')].exports={get:async()=>previous?{statusCode:200,stream:[Buffer.from(JSON.stringify(previous))]}:null,put:async(p,s)=>{previous=JSON.parse(s);writes.push(previous)}};
 require.cache[require.resolve('../lib/crm-shopify')].exports={queryShopify:async()=>{if(failShopify)throw Error('shopify_unavailable');return {};}};
 require.cache[require.resolve('../lib/kbi-ops-analytics')].exports={build:()=>structuredClone(fixture),queryBatch:()=>'',dateRange:(start,end)=>({start,end})};
 require.cache[require.resolve('../lib/ads-refresh')].exports={refreshAds:async()=>{await gate;return {meta:{status:'error',error:'meta_api_190'},google:{status:'api_application_pending'}}}};
 const handlerPath=require.resolve('../api/bi-ops-dashboard');delete require.cache[handlerPath];
 try{
  const {refresh}=require('../api/bi-ops-dashboard');const job=refresh(range,'test-only');
  await new Promise(r=>setImmediate(r));assert.equal(writes.length,1);assert.equal(writes[0].metrics.gmv,123);
  release();const r=await job;assert.equal(writes.length,2);assert.deepEqual(r.daily,fixture.daily);assert.deepEqual(r.channelSales,fixture.channelSales);assert.equal(r.ads.meta.error,'meta_api_190');
  failShopify=true;const fallback=await refresh(range,'test-only');assert.equal(fallback.shopifyStale,true);assert.equal(fallback.generatedAt,fixture.generatedAt);assert.equal(fallback.ads.google.status,'api_application_pending');
 }finally{for(const [p,exports] of saved)require.cache[p].exports=exports;delete require.cache[handlerPath];}
});

test('Google native GMT-04 days reject EST and mixed provider totals stay unavailable',async()=>{
 assert(alignedTimezone('Etc/GMT+4',range,'GMT-04:00'));
 assert(!alignedTimezone('America/New_York',range,'GMT-04:00'));
 const result=await refreshAds(range,{force:true,read:async()=>null,write:async()=>{},providers:{meta:async()=>ready('Meta'),google:async()=>ready('Google')}});
 assert.equal(result.meta.status,'ready');assert.equal(result.google.status,'ready');
 assert.equal(result.complete,false);assert.equal(result.comparable,false);assert.equal(result.totalSpend,null);assert.equal(result.totalRevenue,null);assert.equal(result.blendedRoas,null);assert.equal(result.timeZone,null);
 assert.equal(result.totalUnavailableReason,'not_normalized_to_est');
 const bad=await fetchGoogle(range,{env:googleEnv,fetchImpl:async(url)=>String(url).includes('oauth2')?ok({access_token:'test'}):ok({results:[{customer:{id:'2670021803',currencyCode:'USD',timeZone:'America/New_York',manager:false}}]})}).then(()=>null,e=>e.message);
 assert.equal(bad,'google_timezone_mismatch');
});
test('Google caches cannot reuse EST snapshots and default dates follow native midnight',async()=>{
 const {reportRange,GOOGLE_TIME_ZONE}=require('../lib/ads-common');
 const now=new Date('2026-11-12T04:30:00Z'),paths=[];
 assert.equal(reportRange(null,now).end,'2026-11-11');assert.equal(reportRange(null,now,GOOGLE_TIME_ZONE).end,'2026-11-12');
 const result=await refreshAds(null,{now,read:async p=>{paths.push(p);return {...ready('Meta'),range:reportRange(null,now,GOOGLE_TIME_ZONE),generatedAt:now.toISOString(),spend:999};},write:async()=>{},providers:{meta:async r=>({...ready('Meta'),range:r}),google:async r=>({...ready('Google'),range:r,spend:25.24})}});
 assert.equal(result.google.spend,25.24);assert.equal(result.google.range.end,'2026-11-12');assert.equal(result.meta.range.end,'2026-11-11');
 assert(paths.some(p=>p.includes('/v4/ads/google/gmt-04/')));
 const fail=await refreshAds(range,{force:true,read:async()=>({...ready('Meta'),spend:999}),write:async()=>{},providers:{meta:async()=>ready('Meta'),google:async()=>{throw Error('google_api_403')}}});
 assert.equal(fail.google.spend,null);assert.equal(fail.google.timeZone,'Etc/GMT+4');assert.equal(fail.google.lastSuccessfulAt,null);
});
