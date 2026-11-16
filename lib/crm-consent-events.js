'use strict';
const crypto=require('node:crypto');
const {get,put,list}=require('@vercel/blob');
const PREFIX='crm-consent-events/v1/',META=PREFIX+'connection.json';
const TOPIC='customers_email_marketing_consent/update';
const URI='https://kailash-energy-ai-knowledge-hub.vercel.app/api/crm-consent-webhook';
const digest=v=>crypto.createHash('sha256').update(String(v)).digest('hex');
function authorized(actual,expected){return !!actual&&String(expected||'').length>=24&&digest(actual)===digest(expected);}
function verify(raw,signature,secret){if(!secret||!signature||!/^[A-Za-z0-9+/]{43}=$/.test(signature))return false;const expected=crypto.createHmac('sha256',secret).update(raw).digest();const actual=Buffer.from(signature,'base64');return actual.length===expected.length&&crypto.timingSafeEqual(actual,expected);}
async function read(path){const r=await get(path,{access:'private',useCache:false});if(!r||r.statusCode===404)return null;if(r.statusCode!==200)throw Error('consent_storage_unavailable');const chunks=[];for await(const c of r.stream)chunks.push(c);return JSON.parse(Buffer.concat(chunks).toString());}
async function write(path,data){return put(path,JSON.stringify(data),{access:'private',addRandomSuffix:false,allowOverwrite:true,contentType:'application/json'});}
function normalize(payload,headers){
 const c=payload.email_marketing_consent;
 const occurredAt=c?.consent_updated_at,customer=String(payload.customer_id||'');
 if(!/^\d+$/.test(customer)||!c||!['subscribed','unsubscribed','not_subscribed','pending','redacted','invalid'].includes(c.state))throw Error('invalid_consent_payload');
 if(!occurredAt||!Number.isFinite(Date.parse(occurredAt)))throw Error('missing_consent_event_time');
 if(Date.parse(occurredAt)>Date.now()+300000)throw Error('future_consent_event');
 return {version:1,customerKey:digest(headers['x-shopify-shop-domain']+':'+customer),state:c.state,occurredAt:new Date(occurredAt).toISOString(),receivedAt:new Date().toISOString(),eventId:headers['x-shopify-event-id']||headers['x-shopify-webhook-id']||null};
}
function counts(events,start,end,timezone,coveredFrom){
 const {localDay}=require('./crm-period-report');
 // A partial first day/week must never masquerade as a complete zero.
 if(!coveredFrom||start<=localDay(coveredFrom,timezone))return null;
 const byCustomer=new Map();
 for(const e of events){const arr=byCustomer.get(e.customerKey)||[];arr.push(e);byCustomer.set(e.customerKey,arr);}
 const subscribed=new Set();
 for(const [key,arr] of byCustomer){let previous=null;for(const e of arr.sort((a,b)=>a.occurredAt.localeCompare(b.occurredAt))){const day=localDay(e.occurredAt,timezone);if(day>=start&&day<=end&&e.state==='subscribed'&&previous!=='subscribed')subscribed.add(key);previous=e.state;}}
 return subscribed.size;
}
const QUERY='query CRMConsentWebhooks { webhookSubscriptions(first:50,topics:[CUSTOMERS_EMAIL_MARKETING_CONSENT_UPDATE]) { nodes { id uri topic } pageInfo { hasNextPage endCursor } } }';
const MUTATION='mutation CRMConsentWebhookCreate($uri:String!) { webhookSubscriptionCreate(topic:CUSTOMERS_EMAIL_MARKETING_CONSENT_UPDATE,webhookSubscription:{uri:$uri,format:JSON}) { webhookSubscription { id uri } userErrors { field message } } }';
async function connect(){
 if(!process.env.SHOPIFY_CLIENT_SECRET)throw Error('shopify_webhook_signing_secret_missing');
 const {queryShopify}=require('./crm-shopify');
 const old=await read(META),startedAt=new Date().toISOString();
 const d=await queryShopify(QUERY);if(d.webhookSubscriptions.pageInfo.hasNextPage)throw Error('webhooks_scan_incomplete');
 let hook=d.webhookSubscriptions.nodes.find(x=>x.uri===URI);
 if(!hook){const r=await queryShopify(MUTATION,{uri:URI});if(r.webhookSubscriptionCreate.userErrors.length||!r.webhookSubscriptionCreate.webhookSubscription)throw Error('consent_webhook_registration_failed');hook=r.webhookSubscriptionCreate.webhookSubscription;}
 const meta={version:1,webhookId:hook.id,uri:URI,coveredFrom:old?.webhookId===hook.id?old.coveredFrom:startedAt,verifiedAt:new Date().toISOString()};
 await write(META,meta);console.info('CRM_CONSENT_CONNECTED',JSON.stringify({coveredFrom:meta.coveredFrom,verifiedAt:meta.verifiedAt}));return meta;
}
async function history(){
 const meta=await read(META);if(!meta)return null;
 const {queryShopify}=require('./crm-shopify');const registered=await queryShopify(QUERY);
 if(!registered.webhookSubscriptions.nodes.some(h=>h.id===meta.webhookId&&h.uri===URI))throw Error('consent_webhook_disconnected');
 const events=[];let cursor;
 do{const r=await list({prefix:PREFIX+'events/',limit:1000,cursor});
 for(let i=0;i<r.blobs.length;i+=20){const batch=await Promise.all(r.blobs.slice(i,i+20).map(b=>read(b.pathname)));if(batch.some(x=>!x))throw Error('consent_events_incomplete');events.push(...batch);}
 cursor=r.hasMore?r.cursor:undefined;if(r.hasMore&&!cursor)throw Error('consent_pagination_incomplete');
 }while(cursor);
 return {...meta,events};
}
async function ingest(raw,headers){
 const shop=(process.env.SHOPIFY_SHOP_DOMAIN||'').replace(/^https?:\/\//,'').replace(/\/$/,'');
 if(headers['x-shopify-shop-domain']!==shop||headers['x-shopify-topic']!==TOPIC)throw Error('unexpected_webhook_source');
 if(!verify(raw,headers['x-shopify-hmac-sha256'],process.env.SHOPIFY_CLIENT_SECRET))throw Error('invalid_webhook_signature');
 const e=normalize(JSON.parse(raw.toString('utf8')),headers);
 await write(PREFIX+'events/'+digest(e.customerKey+':'+e.occurredAt+':'+e.state)+'.json',e);
 return {accepted:true};
}
module.exports={PREFIX,META,TOPIC,URI,authorized,verify,normalize,counts,read,write,connect,history,ingest};
