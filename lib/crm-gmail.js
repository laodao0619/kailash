"use strict";
/**
 * Gmail readonly CRM adapter. Requires an actual Google OAuth client
 * and refresh token for the mailbox, not the ChatGPT Gmail connector.
 */
async function token(){
 const client_id=process.env.GMAIL_CLIENT_ID;
 const client_secret=process.env.GMAIL_CLIENT_SECRET;
 const refresh_token=process.env.GMAIL_REFRESH_TOKEN;
 if(!client_id||!client_secret||!refresh_token)throw Error("Gmail backend OAuth not authorized");
 const r=await fetch("https://oauth2.googleapis.com/token",{
  method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},
  body:new URLSearchParams({client_id,client_secret,refresh_token,grant_type:"refresh_token"})
 });
 const j=await r.json();
 if(!r.ok||!j.access_token)throw Error("Gmail OAuth token refresh failed");
 return j.access_token;
}
async function request(t,path){
 const r=await fetch("https://gmail.googleapis.com/gmail/v1/users/me/"+path,{
  headers:{Authorization:"Bearer "+t}
 });
 const j=await r.json().catch(()=>({}));
 if(!r.ok)throw Error("Gmail request failed: "+r.status);
 return j;
}
async function listMessages(t,{pageToken,maxResults=100,after,query}={}){
 const q=["-in:spam","-in:trash","-category:promotions","-category:social","-category:forums"];
 if(query)q.push(query);
 if(after)q.push("after:"+Math.floor(new Date(after).getTime()/1000));
 const p=new URLSearchParams({q:q.join(" "),maxResults:String(Math.min(100,maxResults))});
 if(pageToken)p.set("pageToken",pageToken);
 return request(t,"messages?"+p);
}
async function message(t,id){return request(t,"messages/"+encodeURIComponent(id)+"?format=full");}
async function thread(t,id){return request(t,"threads/"+encodeURIComponent(id)+"?format=metadata&metadataHeaders=From&metadataHeaders=Date");}
function header(m,key){return (m.payload?.headers||[]).find(h=>h.name?.toLowerCase()===key.toLowerCase())?.value||"";}
function emailAddress(s){
 const match=String(s||"").match(/<([^<>\s]+@[^<>\s]+)>/);
 const bare=String(s||"").match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/);
 return (match?.[1]||bare?.[0]||"").toLowerCase();
}
function classifyMessage(m){
 const labels=new Set(m.labelIds||[]);
 const forbidden=["SPAM","TRASH","CATEGORY_PROMOTIONS","CATEGORY_SOCIAL","CATEGORY_FORUMS"];
 if(forbidden.some(x=>labels.has(x)))return "category_excluded";
 const from=emailAddress(header(m,"From"));
 if(!from)return "sender_missing";
 const domain=from.split('@')[1];
 if(/(^|\.)(track123\.com|shopify\.com|myshopify\.com|klaviyo\.com|mailchimp\.com|sendgrid\.net|amazonses\.com|vercel\.com|stripe\.com)$/.test(domain))return "service_notification";
 const local=from.split("@")[0].replace(/[._-]/g,"");
 if(/^(no?reply|donotreply|notification|notifications|mailerdaemon|postmaster|bounce|automated|autoresponder|systemalert|marketing|newsletter|promotions|bulkmail|mailer|tracking|shipment|dispatch|alerts)$/i.test(local))return "automated_sender";
 if(/^(?!no$).+/.test(header(m,"Auto-Submitted")) && !/^no$/i.test(header(m,"Auto-Submitted").trim()))return "auto_submitted";
 if(/^(bulk|list|junk)$/i.test(header(m,"Precedence").trim()))return "mass_mail";
 if(header(m,"List-Unsubscribe") || header(m,"List-Id"))return "mailing_list";
 if(header(m,"X-Auto-Response-Suppress"))return "auto_response";
 const subj=header(m,"Subject").trim();
 if(/^(a shipment from order|your shipment (has been|is)|a package from|2026年\d+月\d+日 的交易款项)/i.test(subj))return "service_notification";
 if(/^(automatic reply|out of office|auto reply|delivery status notification|undeliverable|mail delivery failed|failure notice|自动回复|退信通知|无人值守)/i.test(subj))return "system_reply";
 if(!header(m,"Date")||!m.threadId)return "missing_metadata";
 return "candidate";
}
function decodePart(data){
 if(!data || typeof data !== 'string')return '';
 try{return Buffer.from(data.replace(/-/g,'+').replace(/_/g,'/'),'base64').toString('utf8');}catch{return '';}
}
function messageBody(m){
 const parts=[];
 function walk(part){
  if(!part)return;
  if(part.mimeType==='text/plain'&&part.body?.data)parts.push({kind:0,text:decodePart(part.body.data)});
  else if(part.mimeType==='text/html'&&part.body?.data)parts.push({kind:1,text:decodePart(part.body.data)});
  for(const child of part.parts||[])walk(child);
 }
 walk(m.payload);
 parts.sort((a,b)=>a.kind-b.kind);
 let body=parts[0]?.text||m.snippet||'';
 if(parts[0]?.kind===1)body=body.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<br\s*\/?\s*>/gi,'\n').replace(/<\/p>/gi,'\n').replace(/<[^>]+>/g,' ');
 body=body.replace(/&#(x[\da-f]+|\d+);/gi,(_,code)=>{const n=code[0].toLowerCase()==='x'?parseInt(code.slice(1),16):Number(code);return n>0&&n<=0x10ffff?String.fromCodePoint(n):'';}).replace(/&(?:nbsp|#160);/gi,' ').replace(/&amp;/gi,'&').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&quot;/gi,'"').replace(/&apos;|&#39;/gi,"'").replace(/\r/g,'').replace(/[ \t]+/g,' ').replace(/\n{3,}/g,'\n\n').trim();
 // Do not misrepresent quoted message history as the sender's new request.
 const quote=body.search(/\n\s*(On .{10,120}wrote:|From:\s|De\s*:\s|发件人：|在.{5,140}(?:寫道|写道)：?|Le .{5,140}(?:a écrit|écrit)\s*:|Envoyé\s+depuis\s+l.application|Envoye\s+depuis|[-]+\s*(?:Original Message|Message transféré)|_{5,})/i);
 return (quote>0?body.slice(0,quote):body).slice(0,4500).trim();
}
function compactMessage(m){
 return {id:m.id,threadId:m.threadId,from:emailAddress(header(m,"From")),
 to:emailAddress(header(m,"To")),subject:header(m,"Subject").slice(0,350),
 date:new Date(Number(m.internalDate)).toISOString()};
}
module.exports={token,listMessages,message,thread,header,compactMessage,classifyMessage,messageBody,emailAddress};
