'use strict';
const {numeric,money,summarize,alignedTimezone,TIME_ZONE}=require('./ads-common');
function config(env){
 if(!env.GOOGLE_ADS_CLIENT_ID||!env.GOOGLE_ADS_CLIENT_SECRET||!env.GOOGLE_ADS_REFRESH_TOKEN)throw Error('google_credentials_missing');
 if(env.GOOGLE_ADS_CUSTOMER_ID!=='2670021803')throw Error('google_account_scope_mismatch');
 if(!/^v\d+$/.test(env.GOOGLE_ADS_API_VERSION||''))throw Error('google_api_version_required');
 if(env.GOOGLE_ADS_LOGIN_CUSTOMER_ID&&!/^\d{10}$/.test(env.GOOGLE_ADS_LOGIN_CUSTOMER_ID))throw Error('google_invalid_manager_id');
}
async function client({env=process.env,fetchImpl=fetch,signal}={}){
 config(env);
 const r=await fetchImpl('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',client_id:env.GOOGLE_ADS_CLIENT_ID,client_secret:env.GOOGLE_ADS_CLIENT_SECRET,refresh_token:env.GOOGLE_ADS_REFRESH_TOKEN}),signal});
 const auth=await r.json();if(!r.ok||!auth.access_token)throw Error('google_oauth_failed');
 const headers={Authorization:'Bearer '+auth.access_token,'Content-Type':'application/json',...(env.GOOGLE_ADS_LOGIN_CUSTOMER_ID?{'login-customer-id':env.GOOGLE_ADS_LOGIN_CUSTOMER_ID}:{})};
 // Developer token no longer required under the 2026-09-09 Cloud-project access model.
 const base='https://googleads.googleapis.com/'+env.GOOGLE_ADS_API_VERSION+'/customers/'+env.GOOGLE_ADS_CUSTOMER_ID;
 async function query(query){
  let rows=[],pageToken='';const seen=new Set();
  for(let page=0;page<30;page++){
   const r=await fetchImpl(base+'/googleAds:search',{method:'POST',headers,signal,body:JSON.stringify({query,...(pageToken?{pageToken}:{})})});const d=await r.json();
   if(!r.ok||d.error){const details=JSON.stringify(d.error?.details||[]);if(/CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION|ACTION_NOT_PERMITTED|DEVELOPER_TOKEN_NOT_APPROVED/i.test(details))throw Error('google_api_approval_pending');throw Error('google_api_'+r.status);}
   if(d.results!==undefined&&!Array.isArray(d.results))throw Error('google_invalid_response');rows.push(...(d.results||[]));
   if(!d.nextPageToken)return rows;
   pageToken=d.nextPageToken;if(seen.has(pageToken))throw Error('google_invalid_pagination');seen.add(pageToken);
  }throw Error('google_page_limit');
 }
 return {query};
}
async function inspectGoogleAccount(options={}){
 const c=await client(options);
 const customer=await c.query('SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone, customer.manager FROM customer LIMIT 1');
 const actions=await c.query('SELECT conversion_action.resource_name, conversion_action.id, conversion_action.name, conversion_action.category, conversion_action.status, conversion_action.primary_for_goal FROM conversion_action');
 return {customer:customer[0]?.customer,actions:actions.map(x=>x.conversionAction),query:c.query};
}
async function fetchGoogle(range,options={}){
 const env=options.env||process.env;
 if(env.GOOGLE_ADS_ACCESS_APPROVED!=='true')throw Error('google_api_approval_pending');
 const ids=(env.GOOGLE_ADS_PURCHASE_ACTION_IDS||'').split(',').filter(Boolean);
 if(!ids.length||ids.some(id=>!/^\d+$/.test(id))||new Set(ids).size!==ids.length)throw Error('google_purchase_actions_unconfirmed');
 const {customer,actions,query}=await inspectGoogleAccount(options);
 if(customer?.id!=='2670021803'||customer.manager)throw Error('google_account_scope_mismatch');
 if(customer.currencyCode!=='USD')throw Error('google_currency_mismatch');
 if(!alignedTimezone(customer.timeZone,range))throw Error('google_timezone_mismatch');
 const selected=ids.map(id=>actions.find(a=>String(a.id)===id));
 if(selected.some(a=>!a||a.category!=='PURCHASE'||a.status!=='ENABLED'||a.primaryForGoal!==true||!/^customers\/\d+\/conversionActions\/\d+$/.test(a.resourceName||'')))throw Error('google_purchase_action_not_eligible');
 const where="segments.date BETWEEN '"+range.start+"' AND '"+range.end+"'";
 const costs=await query('SELECT campaign.id, campaign.name, segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks FROM campaign WHERE '+where);
 const conversion=await query('SELECT campaign.id, segments.date, segments.conversion_action, metrics.conversions, metrics.conversions_value, metrics.conversions_by_conversion_date, metrics.conversions_value_by_conversion_date FROM campaign WHERE '+where+' AND segments.conversion_action IN ('+selected.map(a=>"'"+a.resourceName+"'").join(',')+')');
 const rows=new Map();
 const day=date=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||date<range.start||date>range.end)throw Error('google_invalid_report_scope');if(!rows.has(date))rows.set(date,{day:date,spend:0,impressions:0,clicks:0,purchases:0,revenue:0,purchasesByConversionDate:0,revenueByConversionDate:0});return rows.get(date)};
 for(const x of costs){const d=day(x.segments?.date),m=x.metrics||{};d.spend+=numeric(m.costMicros??0)/1e6;d.impressions+=numeric(m.impressions??0);d.clicks+=numeric(m.clicks??0);}
 for(const x of conversion){if(!selected.some(a=>a.resourceName===x.segments?.conversionAction))throw Error('google_unexpected_conversion_action');const d=day(x.segments?.date),m=x.metrics||{};d.purchases+=numeric(m.conversions??0);d.revenue+=numeric(m.conversionsValue??0);d.purchasesByConversionDate+=numeric(m.conversionsByConversionDate??0);d.revenueByConversionDate+=numeric(m.conversionsValueByConversionDate??0);}
 const daily=[...rows.values()].sort((a,b)=>a.day.localeCompare(b.day));
 for(const d of daily){d.spend=money(d.spend);d.revenue=money(d.revenue);d.roas=d.spend?d.revenue/d.spend:null;}
 const generatedAt=new Date().toISOString();
 return {source:'Google Ads API',status:'ready',stale:false,generatedAt,lastSuccessfulAt:generatedAt,range,timeZone:TIME_ZONE,accountTimeZone:customer.timeZone,currency:'USD',...summarize(daily),daily,
  purchasesByConversionDate:daily.reduce((a,b)=>a+b.purchasesByConversionDate,0),revenueByConversionDate:money(daily.reduce((a,b)=>a+b.revenueByConversionDate,0)),purchaseActions:selected,
  attribution:{headline:'metrics.conversions / conversions_value: ad interaction date, selected PURCHASE actions only',conversionDate:'metrics.conversions_by_conversion_date / conversions_value_by_conversion_date',cost:'Independent unsegmented cost query; never sum cost across conversion actions'}};
}
module.exports={fetchGoogle,inspectGoogleAccount};
