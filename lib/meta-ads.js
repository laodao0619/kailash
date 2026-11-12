'use strict';
const {numeric,alignedTimezone,summarize,namingEvidence,TIME_ZONE}=require('./ads-common');
const ACCOUNT_IDS=['810672167888307','1559163378893343'];
const ACTION_TYPES={purchases:['purchase','offsite_conversion.fb_pixel_purchase','omni_purchase'],addToCart:['add_to_cart','offsite_conversion.fb_pixel_add_to_cart','omni_add_to_cart'],checkout:['initiate_checkout','offsite_conversion.fb_pixel_initiate_checkout','omni_initiated_checkout']};
function action(list,types){for(const type of types){const row=(list||[]).find(x=>x.action_type===type);if(row)return numeric(row.value);}return 0;}
function normalize(row,accountId){
 return {day:row.date_start,accountId,campaignId:row.campaign_id||null,campaignName:row.campaign_name||'',adsetId:row.adset_id||null,adsetName:row.adset_name||'',adId:row.ad_id||null,adName:row.ad_name||'',
  spend:numeric(row.spend),impressions:numeric(row.impressions),clicks:numeric(row.clicks),purchases:action(row.actions,ACTION_TYPES.purchases),revenue:action(row.action_values,ACTION_TYPES.purchases),addToCart:action(row.actions,ACTION_TYPES.addToCart),checkout:action(row.actions,ACTION_TYPES.checkout),
  naming:namingEvidence([row.campaign_name,row.adset_name,row.ad_name].filter(Boolean).join(' | '))};
}
function landingPages(creative){
 const s=creative?.object_story_spec||{},links=[creative?.object_url,s.link_data?.link,s.video_data?.call_to_action?.value?.link,...(creative?.asset_feed_spec?.link_urls||[]).map(x=>x.website_url)];
 return [...new Set(links.filter(x=>typeof x==='string'&&/^https?:\/\//i.test(x)))];
}
async function fetchMeta(range,{env=process.env,fetchImpl=fetch,signal}={}){
 if(!env.META_SYSTEM_USER_TOKEN)throw Error('meta_credentials_missing');
 const version=env.META_GRAPH_API_VERSION;
 if(!/^v\d+\.0$/.test(version||''))throw Error('meta_api_version_required');
 const ids=(env.META_AD_ACCOUNT_IDS||ACCOUNT_IDS.join(',')).split(',').map(x=>x.trim());
 if(ids.length!==2||new Set(ids).size!==2||ids.some(x=>!ACCOUNT_IDS.includes(x)))throw Error('meta_account_scope_mismatch');
 const counts=new Map();
 async function call(path,params,id){
  const count=(counts.get(id)||0)+1;counts.set(id,count);if(count>75)throw Error('meta_request_budget_exceeded');
  const u=new URL('https://graph.facebook.com/'+version+'/'+path);for(const [k,v] of Object.entries(params||{}))u.searchParams.set(k,String(v));
  const r=await fetchImpl(u,{headers:{Authorization:'Bearer '+env.META_SYSTEM_USER_TOKEN},signal});const d=await r.json();
  if(!r.ok||d.error){const code=Number(d.error?.code)||r.status;throw Error('meta_api_'+code);}
  return d;
 }
 async function pages(path,params,id){
  let after='',rows=[];const seen=new Set();
  for(let i=0;i<25;i++){
   const d=await call(path,{...params,...(after?{after}:{})},id);
   if(!Array.isArray(d.data))throw Error('meta_invalid_response');rows.push(...d.data);
   if(!d.paging?.next)return rows;
   after=d.paging?.cursors?.after;if(!after||seen.has(after))throw Error('meta_invalid_pagination');seen.add(after);
  }throw Error('meta_page_limit');
 }
 async function account(id){
  const info=await call('act_'+id,{fields:'id,name,currency,timezone_name'},id);
  if(info.currency!=='USD')throw Error('meta_currency_mismatch');
  if(!alignedTimezone(info.timezone_name,range))throw Error('meta_timezone_mismatch');
  async function insights(level){const extra=level==='account'?'':level==='campaign'?',campaign_id,campaign_name':level==='adset'?',campaign_id,campaign_name,adset_id,adset_name':',campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name';
   const rows=await pages('act_'+id+'/insights',{fields:'account_id,spend,impressions,clicks,actions,action_values'+extra,level,time_increment:1,time_range:JSON.stringify({since:range.start,until:range.end}),limit:500},id);
   if(rows.some(x=>x.account_id&&x.account_id!==id||!/^\d{4}-\d{2}-\d{2}$/.test(x.date_start)||x.date_start<range.start||x.date_start>range.end||x.date_stop!==x.date_start))throw Error('meta_invalid_report_scope');
   return rows.map(x=>normalize(x,id));
  }
  const daily=await insights('account'),details={},errors={};
  for(const level of ['campaign','adset','ad']){try{details[level]=await insights(level);}catch(e){errors[level]=e.message;details[level]=[];}}
  let ads=[];
  try{ads=await pages('act_'+id+'/ads',{fields:'id,name,created_time,creative{object_url,object_story_spec,asset_feed_spec}',limit:100},id);}catch(e){errors.adMetadata=e.message;}
  const metadata=new Map(ads.map(x=>[x.id,x]));
  details.ad=details.ad.map(x=>({...x,createdAt:metadata.get(x.adId)?.created_time||null,landingPages:[...new Set([...landingPages(metadata.get(x.adId)?.creative),...x.naming.namedLandingPages])],landingPageEvidence:{creative:landingPages(metadata.get(x.adId)?.creative),name:x.naming.namedLandingPages}}));
  return {accountId:id,name:info.name,timeZone:info.timezone_name,currency:info.currency,daily,...summarize(daily),details,detailErrors:errors};
 }
 const results=await Promise.allSettled(ids.map(account));
 const rejected=results.find(x=>x.status==='rejected');if(rejected)throw rejected.reason;
 const accounts=results.map(x=>x.value),daily=accounts.flatMap(x=>x.daily);
 const dailyTotals=new Map();for(const row of daily){const d=dailyTotals.get(row.day)||[];d.push(row);dailyTotals.set(row.day,d);}
 const dailyCombined=[...dailyTotals].sort(([a],[b])=>a.localeCompare(b)).map(([day,rows])=>({day,...summarize(rows)}));
 const generatedAt=new Date().toISOString();
 return {source:'Meta Marketing API',status:'ready',stale:false,generatedAt,lastSuccessfulAt:generatedAt,range,timeZone:TIME_ZONE,currency:'USD',...summarize(daily),daily:dailyCombined,byAccount:accounts.map(({details,detailErrors,...rest})=>({...rest,detailErrors})),byCampaign:accounts.flatMap(x=>x.details.campaign),byAdset:accounts.flatMap(x=>x.details.adset),byAd:accounts.flatMap(x=>x.details.ad),
  detailsComplete:accounts.every(x=>!Object.keys(x.detailErrors).length),
  attribution:{window:'API account default; no custom action_attribution_windows',actionReportTime:'API default',actionTypePriority:ACTION_TYPES,duplicates:'Choose one action alias; do not sum aliases'},
  settlementNotes:['当天为阶段数；历史日期可能随归因和结算修订。','2026-11-09日报参考944.45 USD，后台曾读到953.89 USD；保留API实际值，差异需人工对账，不强制调整。']};
}
module.exports={fetchMeta,normalize,action,landingPages,ACCOUNT_IDS};
