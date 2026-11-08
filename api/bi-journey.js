"use strict";
// Read-only, source-grounded customer journey. This route never sends email or writes orders.
const crypto=require("node:crypto");
const shopify=require("../lib/crm-shopify");
const gmail=require("../lib/crm-gmail");
const {productHistory,mailSummary,channelOf}=require("../lib/kbi-product-insights");
const CUSTOMER_QUERY=`query KbiCustomerJourney($id:ID!,$cursor:String){
 customer(id:$id){
  id createdAt firstName lastName numberOfOrders
  defaultEmailAddress{emailAddress marketingState}
  orders(first:50,after:$cursor,sortKey:PROCESSED_AT,reverse:true){
   pageInfo{hasNextPage endCursor}
   nodes{
    id name processedAt test cancelledAt displayFinancialStatus displayFulfillmentStatus
    currentSubtotalPriceSet{shopMoney{amount currencyCode}}
    currentTotalPriceSet{shopMoney{amount currencyCode}}
    lineItems(first:30){pageInfo{hasNextPage endCursor} nodes{
     id title quantity
     originalUnitPriceSet{shopMoney{amount currencyCode}}
     discountedUnitPriceAfterAllDiscountsSet{shopMoney{amount currencyCode}}
     image{url altText}
     product{id title handle productType description onlineStoreUrl}
     variant{id title}
    }}
    customerJourneySummary{
     ready
     firstVisit{occurredAt source landingPage referrerUrl utmParameters{source medium campaign}}
     lastVisit{occurredAt source landingPage referrerUrl utmParameters{source medium campaign}}
    }
   }
  }
 }
}`;
const ORDER_PAGE_QUERY=`query KbiOrderPage($id:ID!,$cursor:String){
 customer(id:$id){orders(first:50,after:$cursor,sortKey:PROCESSED_AT,reverse:true){
  pageInfo{hasNextPage endCursor}
  nodes{
   id name processedAt test cancelledAt displayFinancialStatus displayFulfillmentStatus
   currentSubtotalPriceSet{shopMoney{amount currencyCode}}
    currentTotalPriceSet{shopMoney{amount currencyCode}}
   lineItems(first:30){pageInfo{hasNextPage endCursor} nodes{
     id title quantity
     originalUnitPriceSet{shopMoney{amount currencyCode}}
     discountedUnitPriceAfterAllDiscountsSet{shopMoney{amount currencyCode}}
     image{url altText}
     product{id title handle productType description onlineStoreUrl}
     variant{id title}
    }}
   customerJourneySummary{
    ready
    firstVisit{occurredAt source landingPage referrerUrl utmParameters{source medium campaign}}
    lastVisit{occurredAt source landingPage referrerUrl utmParameters{source medium campaign}}
   }
  }
 }}
}`;
const LINE_ITEMS_PAGE_QUERY=`query KbiLineItemPage($id:ID!,$cursor:String){
 node(id:$id){... on Order{
  lineItems(first:50,after:$cursor){
   pageInfo{hasNextPage endCursor}
   nodes{
    id title quantity
    originalUnitPriceSet{shopMoney{amount currencyCode}}
    discountedUnitPriceAfterAllDiscountsSet{shopMoney{amount currencyCode}}
    image{url altText}
    product{id title handle productType description onlineStoreUrl}
    variant{id title}
   }
  }
 }}
}`;
const EMAIL_OWNERS_QUERY=`query KbiEmailOwners($filter:String!){
 customers(first:50,query:$filter){
  pageInfo{hasNextPage}
  nodes{id defaultEmailAddress{emailAddress}}
 }
}`;
async function uniqueEmailOwner(email,id){
 const data=await shopify.queryShopify(EMAIL_OWNERS_QUERY,{filter:"email:"+email});
 const owners=data.customers;
 if(!owners||owners.pageInfo?.hasNextPage)return false;
 const exact=(owners.nodes||[]).filter(c=>address(c.defaultEmailAddress?.emailAddress||"")===email);
 return exact.length===1&&exact[0].id===id;
}
function authorized(req){
 const expected=process.env.KBI_ACCESS_TOKEN||"";
 const given=(req.headers.authorization||"").replace(/^Bearer\s+/i,"");
 if(expected.length<24||!given)return false;
 const a=crypto.createHash("sha256").update(given).digest();
 const b=crypto.createHash("sha256").update(expected).digest();
 return crypto.timingSafeEqual(a,b);
}
function address(s){return gmail.emailAddress(s);}
function event(id,kind,at,title,source,extra={}){
 return {id,kind,at:at||null,title,source,...extra};
}
function mapOrderProduct(x){
 const itemPrice=x.discountedUnitPriceAfterAllDiscountsSet?.shopMoney||
  x.originalUnitPriceSet?.shopMoney||null;
 return {title:x.title,quantity:x.quantity,lineId:x.id,
  productId:x.product?.id||null,variantId:x.variant?.id||null,
  description:String(x.product?.description||"").slice(0,2200),
  productType:x.product?.productType||"",
  imageUrl:x.image?.url||null,productUrl:x.product?.onlineStoreUrl||null,
  unitPrice:itemPrice?.amount==null?null:Number(itemPrice.amount),
  currency:itemPrice?.currencyCode||null};
}
function orderEvent(o){
 const money=o.currentSubtotalPriceSet?.shopMoney;
 const orderTotal=o.currentTotalPriceSet?.shopMoney||money;
 // A timeline can show every order, but the observed product-interest
 // calculation must not count unpaid, test, cancelled or refunded orders.
 const financiallyEligible=["PAID","PARTIALLY_PAID","PARTIALLY_REFUNDED"].includes(o.displayFinancialStatus);
 const amount=money?.amount==null?NaN:Number(money.amount);
 const valid=!!o.processedAt&&!o.test&&!o.cancelledAt&&
  financiallyEligible&&Number.isFinite(amount)&&amount>0;
 const j=o.customerJourneySummary||null;
 const first=j?.ready?j.firstVisit:null;
 const last=j?.ready?j.lastVisit:null;
 return event("shopify:"+o.id,"order",o.processedAt,"Order "+o.name,"Shopify",{
  orderId:o.id,orderName:o.name,
  status:o.displayFinancialStatus||"UNKNOWN",fulfillment:o.displayFulfillmentStatus||"UNKNOWN",
  validForReview:valid,
  amount:orderTotal?.amount??null,currency:orderTotal?.currencyCode||null,
  products:(o.lineItems?.nodes||[]).map(mapOrderProduct),
  productsComplete:!o.lineItems?.pageInfo?.hasNextPage,
  lineItemPageInfo:o.lineItems?.pageInfo||null,
  attribution:{
   status:!j?"unknown":!j.ready?"pending":!first&&!last?"unknown":"recorded_visit",
   firstVisit:first?{at:first.occurredAt,source:first.source||null,landingPage:first.landingPage||null,referrer:first.referrerUrl||null,utm:first.utmParameters||null}:null,
   lastVisit:last?{at:last.occurredAt,source:last.source||null,landingPage:last.landingPage||null,referrer:last.referrerUrl||null,utm:last.utmParameters||null}:null
  }
 });
}
async function mailEvents(email){
 const t=await gmail.token();
 const filter='{from:"'+email+'" to:"'+email+'"} -in:spam -in:trash -category:promotions -category:social -category:forums';
 const seen=new Set(),matches=[];
 let cursor=null,more=false,pages=0,failed=0;
 // Bounded pagination, rather than silently truncating at the first hundred.
 // If there are more than 500, report partial coverage explicitly.
 for(;pages<5;pages++){
  const result=await gmail.listMessages(t,{query:filter,maxResults:100,pageToken:cursor||undefined});
  const ids=(result.messages||[]).filter(m=>m?.id&&!seen.has(m.id));
  for(const item of ids)seen.add(item.id);
  for(let i=0;i<ids.length;i+=8){
   const group=await Promise.all(ids.slice(i,i+8).map(async item=>{
    try{return await gmail.message(t,item.id);}catch(_){failed++;return null;}
   }));
   for(const m of group){
    if(!m||gmail.classifyMessage(m)!=="candidate")continue;
    const c=gmail.compactMessage(m);
    const from=address(c.from),to=address(c.to);
    if(from!==email&&to!==email)continue;
    matches.push({c,m,direction:from===email?"inbound":"outbound"});
   }
  }
  cursor=result.nextPageToken||null;
  more=!!cursor;
  if(!more)break;
 }
 const knownThreads=new Set(matches.filter(x=>x.direction==="inbound").map(x=>x.c.threadId));
 const output=[];
 for(const {c,m,direction} of matches){
  // Outbound marketing and unrelated conversations are not support replies.
  if(direction==="outbound"&&!knownThreads.has(c.threadId))continue;
  const snippet=String(m.snippet||"").slice(0,250);
  const claim=direction==="inbound"&&/\b(did not receive|not received|haven.t received|never received|package missing|order missing|not arrived|still waiting)\b/i.test(snippet);
  output.push(event("gmail:"+c.id,"communication",c.date,c.subject||"Customer email","Gmail",{
   threadId:c.threadId,channel:"email",direction,
   evidenceType:direction==="inbound"?"customer_message":"service_reply_in_customer_thread",
   preview:snippet,issueFlag:claim?"possible_nonreceipt_claim":null,
   issueVerified:false,gmailUrl:"https://mail.google.com/mail/u/0/#all/"+encodeURIComponent(c.threadId)
  }));
 }
 return {events:output,complete:!more&&failed===0,more,failed,scanned:seen.size,returned:matches.length,pages:pages+1};
}
module.exports=async(req,res)=>{
 res.setHeader("Cache-Control","private, no-store");
 res.setHeader("X-Content-Type-Options","nosniff");
 if(req.method!=="GET")return res.status(405).json({ok:false,error:"method_not_allowed"});
 if(!process.env.KBI_ACCESS_TOKEN)return res.status(503).json({ok:false,error:"kbi_auth_not_configured"});
 if(!authorized(req))return res.status(401).json({ok:false,error:"unauthorized"});
 const customerId=String(req.query?.id||"");
 if(!/^\d{5,25}$/.test(customerId))return res.status(400).json({ok:false,error:"invalid_customer_id"});
 if(!(process.env.SHOPIFY_SHOP_DOMAIN&&(process.env.SHOPIFY_ADMIN_ACCESS_TOKEN||
    (process.env.SHOPIFY_CLIENT_ID&&process.env.SHOPIFY_CLIENT_SECRET))))
  return res.status(503).json({ok:false,error:"shopify_backend_not_configured"});
 try{
  const gid="gid://shopify/Customer/"+customerId;
  const data=await shopify.queryShopify(CUSTOMER_QUERY,{id:gid,cursor:null});
  const c=data.customer;
  if(!c)return res.status(404).json({ok:false,error:"customer_not_found"});
  const email=address(c.defaultEmailAddress?.emailAddress||"");
  const orders=(c.orders?.nodes||[]).map(orderEvent);
  let pageInfo=c.orders?.pageInfo||{hasNextPage:false,endCursor:null};
  let pageCount=1;
  // Read additional pages without guessing that first 50 orders are lifetime.
  while(pageInfo.hasNextPage&&pageInfo.endCursor&&pageCount<6){
   const next=await shopify.queryShopify(ORDER_PAGE_QUERY,{id:gid,cursor:pageInfo.endCursor});
   const connection=next.customer?.orders;
   if(!connection?.pageInfo||!Array.isArray(connection.nodes))throw Error("incomplete_order_page");
   orders.push(...connection.nodes.map(orderEvent));
   pageInfo=connection.pageInfo;pageCount++;
  }
  // Recover additional line items for complex orders without imposing a
  // heavyweight per-customer unlimited query. Unfinished orders remain
  // explicitly marked partial rather than silently losing their products.
  let lineItemExtraPages=0;
  for(const order of orders){
   if(order.productsComplete||lineItemExtraPages>=12)continue;
   let info=order.lineItemPageInfo||null;
   // The initial connection is exposed via orderEvent below.
   while(info?.hasNextPage&&info.endCursor&&lineItemExtraPages<12){
    const data=await shopify.queryShopify(LINE_ITEMS_PAGE_QUERY,{
     id:order.orderId,cursor:info.endCursor
    });
    const more=data.node?.lineItems;
    if(!more?.pageInfo||!Array.isArray(more.nodes))throw Error("incomplete_line_items");
    order.products.push(...more.nodes.map(mapOrderProduct));
    info=more.pageInfo;lineItemExtraPages++;
   }
   order.productsComplete=!info?.hasNextPage;
  }
  let communications=[],mailCoverage="no_customer_email",mailScanned=0,mailFailed=0;
  if(email){
   // Never attach private Gmail correspondence to ambiguous customer identities.
   let ownerVerified=false;
   try{ownerVerified=await uniqueEmailOwner(email,c.id);}
   catch(_){mailCoverage="customer_identity_check_failed";}
   if(!ownerVerified && mailCoverage==="no_customer_email")mailCoverage="ambiguous_customer_email";
   if(ownerVerified){
    if(!(process.env.GMAIL_CLIENT_ID&&process.env.GMAIL_CLIENT_SECRET&&process.env.GMAIL_REFRESH_TOKEN)){
     mailCoverage="gmail_backend_not_configured";
    }else{
     try{
      const mail=await mailEvents(email);
      communications=mail.events;
      mailScanned=mail.scanned;mailFailed=mail.failed;
      mailCoverage=mail.complete?"retrieved_all_query_matches":mail.failed?"partial_mail_fetch_errors":"partial_more_messages";
     }catch(_){mailCoverage="gmail_backend_unavailable";}
    }
   }
  }
  // Preserve the pre-order marketing visit as an evidence-backed event.
  const visits=[];
  const seenVisits=new Set();
  for(const o of orders){
   for(const [which,visit] of [["first",o.attribution?.firstVisit],["last",o.attribution?.lastVisit]]){
    if(!visit?.at)continue;
    const key=[o.orderId,visit.at,visit.source||"",JSON.stringify(visit.utm||{})].join("|");
    if(seenVisits.has(key))continue;
    seenVisits.add(key);
    visits.push(event("visit:"+o.orderId+":"+which,"acquisition_visit",visit.at,
      "Recorded "+which+" pre-order visit","Shopify",{
       relatedOrderId:o.orderId,visitSource:visit.source,utm:visit.utm||null,
       channel:channelOf(visit),
       landingPage:visit.landingPage||null,
       attributionMethod:"recorded_touch_not_incrementality"
    }));
   }
  }
  const events=[
   event("shopify:"+c.id+":created","customer_created",c.createdAt,"Customer account created","Shopify"),
   ...visits,...orders,...communications
  ].filter(e=>e.at).sort((a,b)=>String(a.at).localeCompare(String(b.at)));
  const purchaseInsights=productHistory(orders);
  const communicationSummary=mailSummary(communications);
  return res.status(200).json({
   ok:true,asOf:new Date().toISOString(),
   profile:{productPreferenceNarrative:purchaseInsights.narrative,productInterests:purchaseInsights.preferences,productSummary:purchaseInsights.categories,
    products:purchaseInsights.products,method:"observed_purchased_product_and_catalog_description"},
   mailSummary:communicationSummary,
   customer:{id:c.id,firstName:c.firstName||"",lastName:c.lastName||"",
    email:email||null,ordersReported:c.numberOfOrders??null,
    marketingState:c.defaultEmailAddress?.marketingState||null},
   events,coverage:{orders:pageInfo.hasNextPage?"partial_max_300":"all_returned_orders",
    email:mailCoverage,mailScanned,mailFailed,mailMaxQueryResults:500,
    acquisition:"per_order_recorded_visits_only",
    products:orders.some(o=>!o.productsComplete)?"partial_line_items":"returned_order_line_items",
    lineItemExtraPages,orderPages:pageCount,
    financialLedger:"not_audited",rfm:"not_computed"},
   note:"Marketing touches are recorded observations, not causal attribution. Customer email is matched by verified sender."
  });
 }catch(e){
  // Unit-test-only diagnostics; never expose private data or stack in HTTP responses.
  if(process.env.KBI_TEST_DIAGNOSTICS==="1")console.error("KBI TEST:",e?.stack||e);
  const s=String(e?.message||"");
  return res.status(502).json({ok:false,error:s.includes("Shopify")?"shopify_unavailable":"source_unavailable"});
 }
};
