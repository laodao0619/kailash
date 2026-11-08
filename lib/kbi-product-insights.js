"use strict";
/**
 * Deterministic evidence-based product and customer-service summaries.
 * Preferences are inferred from bought product text, not demographics.
 * Do not call observations a causal attribution or a confirmed preference.
 */
const SIGNALS=[
 {label:"Vajra · 金刚杵",re:/\bvajra\b|金刚杵/i},
 {label:"Thokcha · 天铁",re:/\bthokcha\b|sky iron|天铁/i},
 {label:"Zakiram · 扎基拉姆",re:/\bzakiram\b|扎基拉姆/i},
 {label:"Lotus · 莲花",re:/\blotus\b|莲花/i},
 {label:"Mala · 念珠",re:/\bmala\b|prayer beads|念珠/i},
 {label:"Turquoise · 绿松石",re:/\bturquoise\b|绿松石/i},
 {label:"Obsidian · 黑曜石",re:/\bobsidian\b|黑曜石/i},
 {label:"Amethyst · 紫水晶",re:/\bamethyst\b|紫水晶/i},
 {label:"Woven · 编织",re:/\bwoven\b|macrame|braid|编织/i},
 {label:"Protection · 守护",re:/\bprotection\b|\bguardian\b|守护/i},
 {label:"Butter Lamp · 供灯",re:/\bbutter lamp\b|供灯/i},
 {label:"Prayer Flags · 经幡",re:/\bprayer flag\b|经幡/i}
];
function productCategory(product){
 const type=String(product.productType||"").trim();
 if(type)return type.slice(0,75);
 const s=String(product.title||"");
 if(/necklace|pendant|项链|吊坠/i.test(s))return "Necklace / Pendant";
 if(/bracelet|wrist|手链|手串/i.test(s))return "Bracelet";
 if(/ring\b|戒指/i.test(s))return "Ring";
 if(/mala|念珠/i.test(s))return "Mala";
 return "其他饰品";
}
function signalTags(product){
 const text=[product.title,product.description,product.productType].filter(Boolean).join(" ");
 return SIGNALS.filter(s=>s.re.test(text)).map(s=>s.label);
}
function productHistory(orderEvents){
 const map=new Map();
 for(const order of orderEvents||[]){
  if(order?.kind!=="order")continue;
  for(const product of order.products||[]){
   if(!product?.title||!Number.isFinite(Number(product.quantity))||Number(product.quantity)<=0)continue;
   const key=product.productId||product.variantId||("title:"+product.title.trim().toLowerCase());
   let item=map.get(key);
   if(!item){
    item={key,productId:product.productId||null,title:product.title,
     description:product.description||"",productType:productCategory(product),
     imageUrl:product.imageUrl||null,productUrl:product.productUrl||null,
     quantity:0,validQuantity:0,orders:0,validOrders:0,lastAt:null,
     tags:signalTags(product),purchases:[],currency:product.currency||null};
    map.set(key,item);
   }
   const qty=Number(product.quantity);
   item.quantity+=qty;item.orders++;
   if(order.validForReview){item.validQuantity+=qty;item.validOrders++;}
   if(!item.lastAt||String(order.at||"")>item.lastAt)item.lastAt=order.at;
   if(product.imageUrl)item.imageUrl=product.imageUrl;
   if(product.productUrl)item.productUrl=product.productUrl;
   if(product.description)item.description=product.description;
   if(product.productType)item.productType=product.productType;
   if(item.purchases.length<50)item.purchases.push({
    orderId:order.orderId,orderName:order.orderName,at:order.at,quantity:qty,
    unitPrice:product.unitPrice??null,currency:product.currency||order.currency||null,
    validForReview:!!order.validForReview
   });
  }
 }
 const products=[...map.values()].sort((a,b)=>b.validOrders-a.validOrders||
  b.validQuantity-a.validQuantity||String(b.lastAt).localeCompare(String(a.lastAt)));
 const categories=new Map(),tagMap=new Map();
 for(const p of products){
  if(!p.validOrders)continue; // Avoid fully refunded purchases defining preferences.
  const category=categories.get(p.productType)||{label:p.productType,orderLines:0,quantity:0,productKeys:[]};
  category.orderLines+=p.validOrders;category.quantity+=p.validQuantity;
  category.productKeys.push(p.key);categories.set(p.productType,category);
  for(const label of p.tags){
   const t=tagMap.get(label)||{label,productKeys:[],orders:0,quantity:0,verifiedPreference:false};
   t.productKeys.push(p.key);t.orders+=p.validOrders;t.quantity+=p.validQuantity;
   tagMap.set(label,t);
  }
 }
 return {
  products,categories:[...categories.values()].sort((a,b)=>b.orderLines-a.orderLines),
  preferences:[...tagMap.values()].sort((a,b)=>b.orders-a.orders),
  note:"Observed patterns from actual product titles, catalog types and descriptions. No confirmed personal preference."
 };
}
function channelOf(visit){
 const u=visit?.utm||{};
 const value=[u.source,u.medium,u.campaign,visit?.source||"",visit?.referrer||""].join(" ").toLowerCase();
 if(/facebook|instagram|\bmeta\b|\bfb\b|\big\b/.test(value))return "meta";
 if(/google|\bgads\b|adwords|\bcpc.google\b/.test(value))return "google";
 if(/email|klaviyo|mailchimp|newsletter/.test(value))return "email";
 if(/pinterest/.test(value))return "pinterest";
 if(/organic|direct|search/.test(value))return "organic";
 return "unknown";
}
function mailSummary(events){
 const messages=(events||[]).filter(e=>e.kind==="communication"&&e.threadId);
 const threads=new Map();
 for(const e of messages){
  const id=e.threadId;
  const t=threads.get(id)||{threadId:id,subject:e.title||"未注明主题",
   inbound:0,outbound:0,issues:0,lastAt:null,lastPreview:"",gmailUrl:e.gmailUrl||null};
  if(e.direction==="outbound")t.outbound++;
  else t.inbound++;
  if(e.issueFlag)t.issues++;
  if(!t.lastAt||String(e.at)>t.lastAt){
   t.lastAt=e.at;t.lastPreview=e.preview||"";t.subject=e.title||t.subject;
  }
  threads.set(id,t);
 }
 const list=[...threads.values()].sort((a,b)=>String(b.lastAt).localeCompare(String(a.lastAt)));
 return {messages:messages.length,threads:list.length,
  inbound:messages.filter(x=>x.direction!=="outbound").length,
  outbound:messages.filter(x=>x.direction==="outbound").length,
  possibleIssues:list.filter(x=>x.issues>0).length,
  conversations:list.slice(0,100).map(t=>({...t,
   summary:t.subject+(t.issues?" · 出现可能的配送/售后问题，需人工核实":"")+
    (t.inbound&&t.outbound?" · 有客服往来":" · 当前仅有部分对话记录")})),
  method:"Evidence-only subject, snippet and direction summary; not an AI semantic assessment."};
}
module.exports={productHistory,productCategory,signalTags,channelOf,mailSummary};
