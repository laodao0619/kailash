"use strict";
// Read-only, source-grounded customer journey. This route never sends email or writes orders.
const crypto=require("node:crypto");
const shopify=require("../lib/crm-shopify");
const gmail=require("../lib/crm-gmail");
const {productTags}=require("../lib/kbi-customer-profile");
const CUSTOMER_QUERY=`query KbiCustomerJourney($id:ID!){
 customer(id:$id){
  id createdAt firstName lastName numberOfOrders
  defaultEmailAddress{emailAddress marketingState}
  orders(first:50,sortKey:PROCESSED_AT,reverse:true){
   pageInfo{hasNextPage endCursor}
   nodes{
    id name processedAt test cancelledAt displayFinancialStatus displayFulfillmentStatus
    currentSubtotalPriceSet{shopMoney{amount currencyCode}}
    lineItems(first:12){pageInfo{hasNextPage} nodes{title quantity}}
    customerJourneySummary{
     ready
     firstVisit{occurredAt source landingPage referrerUrl utmParameters{source medium campaign}}
     lastVisit{occurredAt source landingPage referrerUrl utmParameters{source medium campaign}}
    }
   }
  }
 }
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
function orderEvent(o){
 const money=o.currentSubtotalPriceSet?.shopMoney;
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
  amount:money?.amount??null,currency:money?.currencyCode||null,
  products:(o.lineItems?.nodes||[]).map(x=>({title:x.title,quantity:x.quantity})),
  productsComplete:!o.lineItems?.pageInfo?.hasNextPage,
  attribution:{
   status:!j?"unknown":!j.ready?"pending":!first&&!last?"unknown":"recorded_visit",
   firstVisit:first?{at:first.occurredAt,source:first.source||null,landingPage:first.landingPage||null,referrer:first.referrerUrl||null,utm:first.utmParameters||null}:null,
   lastVisit:last?{at:last.occurredAt,source:last.source||null,landingPage:last.landingPage||null,referrer:last.referrerUrl||null,utm:last.utmParameters||null}:null
  }
 });
}
async function mailEvents(email){
 const t=await gmail.token();
 const query=new URLSearchParams({q:'from:"'+email+'" -in:spam -in:trash -category:promotions -category:social -category:forums',maxResults:"50"});
 const response=await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages?"+query,{
  headers:{Authorization:"Bearer "+t}
 });
 if(!response.ok)throw Error("gmail_list_failed");
 const result=await response.json();
 const output=[];
 for(const item of (result.messages||[]).slice(0,50)){
  const m=await gmail.message(t,item.id);
  if(gmail.classifyMessage(m)!=="candidate")continue;
  const c=gmail.compactMessage(m);
  // Gmail search can match quoted threads unexpectedly; verify the actual sender.
  if(address(c.from)!==email)continue;
  const snippet=String(m.snippet||"").slice(0,250);
  const claim=/\b(did not receive|not received|haven.t received|never received|package missing|order missing|not arrived|still waiting)\b/i.test(snippet);
  output.push(event("gmail:"+c.id,"communication",c.date,c.subject||"Customer email","Gmail",{
   threadId:c.threadId,channel:"email",evidenceType:"customer_message",
   preview:snippet,
   issueFlag:claim?"possible_nonreceipt_claim":null,
   issueVerified:false,
   gmailUrl:"https://mail.google.com/mail/u/0/#all/"+encodeURIComponent(c.threadId)
  }));
 }
 return {events:output,complete:!result.nextPageToken};
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
  const data=await shopify.queryShopify(CUSTOMER_QUERY,{id:"gid://shopify/Customer/"+customerId});
  const c=data.customer;
  if(!c)return res.status(404).json({ok:false,error:"customer_not_found"});
  const email=address(c.defaultEmailAddress?.emailAddress||"");
  const orders=(c.orders?.nodes||[]).map(orderEvent);
  // Do not claim complete lifetime history from a single 50-order page.
  let communications=[],mailCoverage="no_customer_email";
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
      mailCoverage=mail.complete?"sample_up_to_50":"partial_more_messages";
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
       landingPage:visit.landingPage||null,
       attributionMethod:"recorded_touch_not_incrementality"
    }));
   }
  }
  const events=[
   event("shopify:"+c.id+":created","customer_created",c.createdAt,"Customer account created","Shopify"),
   ...visits,...orders,...communications
  ].filter(e=>e.at).sort((a,b)=>String(a.at).localeCompare(String(b.at)));
  return res.status(200).json({
   ok:true,asOf:new Date().toISOString(),
   profile:{productInterests:productTags(orders),method:"observed_order_title_evidence_only"},
   customer:{id:c.id,firstName:c.firstName||"",lastName:c.lastName||"",
    email:email||null,ordersReported:c.numberOfOrders??null,
    marketingState:c.defaultEmailAddress?.marketingState||null},
   events,coverage:{orders:c.orders?.pageInfo?.hasNextPage?"partial_first_50":"all_returned_orders",
    email:mailCoverage,acquisition:"per_order_recorded_visits_only",
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
