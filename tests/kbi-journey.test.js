"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const handler=require("../api/bi-journey");
const original={...process.env};
const originalFetch=global.fetch;
const EMAIL="customer@example.test";
function response(data,status=200){
 return {ok:status>=200&&status<300,status,json:async()=>data};
}
function req(id="12345678901",token="the-secret-that-is-long-enough") {
 return {method:"GET",query:{id},headers:{authorization:"Bearer "+token}};
}
function res(){
 return {code:200,headers:{},body:null,setHeader(k,v){this.headers[k]=v;},
 status(n){this.code=n;return this;},json(v){this.body=v;return this;}};
}
function shopOrder(){
 return {id:"gid://shopify/Order/100",name:"7002",processedAt:"2026-10-08T13:13:57Z",
  test:false,cancelledAt:null,displayFinancialStatus:"PAID",displayFulfillmentStatus:"FULFILLED",
  currentSubtotalPriceSet:{shopMoney:{amount:"463.08",currencyCode:"USD"}},
  currentTotalPriceSet:{shopMoney:{amount:"485.00",currencyCode:"USD"}},
  lineItems:{pageInfo:{hasNextPage:false},nodes:[{
   id:"gid://shopify/LineItem/111",title:"Vajra pendant",quantity:1,
   discountedUnitPriceAfterAllDiscountsSet:{shopMoney:{amount:"149.90",currencyCode:"USD"}},
   image:{url:"https://cdn.shopify.com/s/files/1/picture.jpg",altText:"Vajra"},
   product:{id:"gid://shopify/Product/987",title:"Vajra pendant",
    handle:"vajra-pendant",productType:"Necklace",
    description:"Silver Vajra protective pendant in handmade Tibetan style",
    onlineStoreUrl:"https://kailashenergy.com/products/vajra-pendant"},
   variant:{id:"gid://shopify/ProductVariant/888",title:"Default"}
  }]},
  customerJourneySummary:{ready:true,
   firstVisit:{occurredAt:"2026-10-06T00:00:00Z",source:"facebook",
    landingPage:"https://store.example.test/item",referrerUrl:null,
    utmParameters:{source:"facebook",medium:"cpc",campaign:"test_campaign"}},
   lastVisit:null}};
}
function setupFetch({duplicate=false,ambiguous=false,extraPage=false,extraLines=false,mailPages=false,mailFailure=false,outbound=false,financialStatus="PAID",mailDate="2026-11-08T08:51:12Z"}={}){
 let calls=[];
 global.fetch=async(url,options={})=>{
  calls.push(String(url));
  if(String(url).includes("/admin/api/")&&JSON.parse(options.body||"{}").query?.includes("KbiEmailOwners"))
   return response({data:{customers:{pageInfo:{hasNextPage:false},nodes:[
    {id:"gid://shopify/Customer/12345678901",defaultEmailAddress:{emailAddress:EMAIL}},
    ...(ambiguous?[{id:"gid://shopify/Customer/22222222222",defaultEmailAddress:{emailAddress:EMAIL}}]:[])
   ]}}});
  if(String(url).includes("/admin/api/")&&JSON.parse(options.body||"{}").query?.includes("KbiLineItemPage"))
   return response({data:{node:{lineItems:{pageInfo:{hasNextPage:false,endCursor:null},nodes:[{...shopOrder().lineItems.nodes[0],id:"gid://shopify/LineItem/999",title:"Lotus bracelet",quantity:2}]}}}});
  if(String(url).includes("/admin/api/")&&JSON.parse(options.body||"{}").query?.includes("KbiOrderPage"))
   return response({data:{customer:{orders:{pageInfo:{hasNextPage:false,endCursor:null},
    nodes:[{...shopOrder(),id:"gid://shopify/Order/101",name:"7003",processedAt:"2026-11-04T13:00:00Z"}]}}}});
  if(String(url).includes("/admin/api/"))return response({data:{customer:{
   id:"gid://shopify/Customer/12345678901",firstName:"Sample",lastName:"Customer",createdAt:"2026-10-02T00:00:00Z",
   numberOfOrders:extraPage?"2":"1",defaultEmailAddress:{emailAddress:EMAIL,marketingState:"SUBSCRIBED"},
   orders:{pageInfo:{hasNextPage:extraPage,endCursor:extraPage?"next-order-cursor":null},
    nodes:[{...shopOrder(),displayFinancialStatus:financialStatus,
     lineItems:{...shopOrder().lineItems,pageInfo:{hasNextPage:extraLines,endCursor:extraLines?"line-cursor":null}}}]}}}});
  if(String(url).includes("oauth2.googleapis.com/token"))return response({access_token:"test-oauth"});
  if(String(url).includes("/messages?")){
   const second=String(url).includes("pageToken=");
   return response({messages:second?[{id:"mail-3"}]:[{id:"mail-1"},...(outbound?[{id:"mail-2"}]:[])],
    nextPageToken:mailPages&&!second?"gmail-second-page":undefined});
  }
  if(String(url).includes("messages/mail-3"))return mailFailure?response({},403):response({
   id:"mail-3",threadId:"thread-3",snippet:"Please update my order",labelIds:["INBOX"],
   internalDate:String(new Date("2026-11-07T09:30:00Z").getTime()),
   payload:{headers:[{name:"From",value:EMAIL},{name:"To",value:"service@example.test"},
    {name:"Subject",value:"Order change request"},{name:"Date",value:"2026-11-07T09:30:00Z"}]}});
  if(String(url).includes("messages/mail-2"))return response({
   id:"mail-2",threadId:"thread-1",snippet:"We are checking your delivery status.",
   labelIds:["SENT"],internalDate:String(new Date("2026-11-08T09:30:00Z").getTime()),
   payload:{headers:[{name:"From",value:"service@example.test"},{name:"To",value:EMAIL},
    {name:"Subject",value:"Re: Order 7002, not received"},
    {name:"Date",value:"2026-11-08T09:30:00Z"}]}});
  if(String(url).includes("messages/mail-1"))return response({
   id:"mail-1",threadId:"thread-1",snippet:"Did not receive order",labelIds:["INBOX"],internalDate:String(new Date(mailDate).getTime()),
   payload:{headers:[{name:"From",value:(duplicate?"another@example.test":EMAIL)},
    {name:"To",value:"service@example.test"},{name:"Subject",value:"Re: Order 7002, not received"},
    {name:"Date",value:mailDate}]}});
  throw Error("Unexpected test URL");
 };
 return calls;
}
function setEnvironment(){
 process.env.KBI_TEST_DIAGNOSTICS="1";
 process.env.KBI_ACCESS_TOKEN="the-secret-that-is-long-enough";
 process.env.SHOPIFY_SHOP_DOMAIN="fake.myshopify.com";
 process.env.SHOPIFY_ADMIN_ACCESS_TOKEN="test-shopify-admin-token";
 process.env.GMAIL_CLIENT_ID="test-client";
 process.env.GMAIL_CLIENT_SECRET="test-secret";
 process.env.GMAIL_REFRESH_TOKEN="test-refresh";
}
test.after(()=>{global.fetch=originalFetch;
 for(const k of ["KBI_ACCESS_TOKEN","SHOPIFY_SHOP_DOMAIN","SHOPIFY_ADMIN_ACCESS_TOKEN","GMAIL_CLIENT_ID","GMAIL_CLIENT_SECRET","GMAIL_REFRESH_TOKEN"]){
  if(original[k]===undefined)delete process.env[k];else process.env[k]=original[k];
 }
});
test("without KBI token no private customer data is fetched",async()=>{
 setEnvironment();setupFetch();
 const out=res();await handler(req("12345678901","wrong"),out);
 assert.equal(out.code,401);assert.equal(out.body.error,"unauthorized");
});
test("live timeline combines Shopify attribution, order and verified customer mail",async()=>{
 setEnvironment();const calls=setupFetch();const out=res();
 await handler(req(),out);
 assert.equal(out.code,200,JSON.stringify(out.body)+" calls: "+calls.join(";"));
 assert.equal(out.body.ok,true);
 assert.deepEqual(out.body.events.map(x=>x.kind),["customer_created","acquisition_visit","order","communication"]);
 assert.equal(out.body.events[1].utm.source,"facebook");
 const order=out.body.events[2];
 assert.equal(order.attribution.firstVisit.utm.source,"facebook");
 assert.equal(order.attribution.firstVisit.utm.medium,"cpc");
 assert.equal(order.validForReview,true);
 assert.equal(out.body.events[3].source,"Gmail");
 assert.equal(out.body.events[3].issueFlag,"possible_nonreceipt_claim");
 assert.equal(out.body.events[3].issueVerified,false);
 assert.equal(out.body.coverage.financialLedger,"not_audited");
 assert.equal(out.body.profile.productInterests.some(x=>x.label.startsWith("Vajra")),true);
 assert.equal(out.body.profile.productInterests[0].verifiedPreference,false);
 assert.equal(out.body.profile.products.length,1);
 assert.equal(out.body.profile.products[0].imageUrl,"https://cdn.shopify.com/s/files/1/picture.jpg");
 assert.equal(out.body.profile.products[0].productUrl,"https://kailashenergy.com/products/vajra-pendant");
 assert.equal(out.body.profile.products[0].purchases[0].unitPrice,149.90);
 assert.equal(out.body.profile.productSummary[0].label,"Necklace");
 assert.equal(order.amount,"485.00");
 assert.equal(out.body.mailSummary.inbound,1);
 assert.equal(calls.filter(x=>x.includes("gmail.googleapis.com")).length,2);
 assert.equal(calls.filter(x=>x.includes("myshopify.com")).length,2);
});
test("a message from an unexpected sender is never linked",async()=>{
 setEnvironment();const calls=setupFetch({duplicate:true});const out=res();
 await handler(req(),out);
 assert.equal(out.code,200);
 assert.equal(out.body.events.filter(x=>x.kind==="communication").length,0);
});
test("Customer 360 loads subsequent Shopify order pages instead of stopping after first page",async()=>{
 setEnvironment();const calls=setupFetch({extraPage:true});const out=res();
 await handler(req(),out);
 assert.equal(out.code,200);
 assert.equal(out.body.events.filter(x=>x.kind==="order").length,2);
 assert.equal(out.body.coverage.orders,"all_returned_orders");
 assert.equal(calls.filter(x=>x.includes("myshopify.com")).length,3);
});
test("Customer 360 joins outgoing service replies only within customer-originated threads",async()=>{
 setEnvironment();setupFetch({outbound:true});const out=res();
 await handler(req(),out);
 assert.equal(out.code,200);
 const messages=out.body.events.filter(x=>x.kind==="communication");
 assert.equal(messages.length,2);
 assert.deepEqual(messages.map(x=>x.direction),["inbound","outbound"]);
 assert.equal(messages[1].evidenceType,"service_reply_in_customer_thread");
 assert.equal(out.body.mailSummary.outbound,1);
 assert.equal(out.body.mailSummary.threads,1);
});
test("order with over 30 line items fetches remaining Shopify page and updates product interest",async()=>{
 setEnvironment();const calls=setupFetch({extraLines:true});const out=res();
 await handler(req(),out);
 assert.equal(out.code,200,JSON.stringify(out.body));
 const order=out.body.events.find(e=>e.kind==="order");
 assert.equal(order.products.length,2);
 assert.equal(order.productsComplete,true);
 assert.equal(out.body.coverage.lineItemExtraPages,1);
 assert.equal(out.body.coverage.products,"returned_order_line_items");
 assert(calls.filter(x=>x.includes("myshopify.com")).length===3);
});
test("Gmail communication follows next-page tokens without losing the second thread",async()=>{
 setEnvironment();const calls=setupFetch({mailPages:true});const out=res();
 await handler(req(),out);
 assert.equal(out.code,200,JSON.stringify(out.body));
 assert.equal(out.body.events.filter(x=>x.kind==="communication").length,2);
 assert.equal(out.body.coverage.email,"retrieved_all_query_matches");
 assert.equal(out.body.coverage.mailScanned,2);
 assert(calls.filter(x=>x.includes("/messages?")).length===2);
});
test("inaccessible Gmail message reports incomplete rather than claiming total coverage",async()=>{
 setEnvironment();setupFetch({mailPages:true,mailFailure:true});const out=res();
 await handler(req(),out);
 assert.equal(out.code,200);
 assert.equal(out.body.coverage.email,"partial_mail_fetch_errors");
 assert.equal(out.body.coverage.mailFailed,1);
});
test("a fully refunded order stays on timeline but cannot create interest tags",async()=>{
 setEnvironment();setupFetch({financialStatus:"REFUNDED"});const out=res();
 await handler(req(),out);
 assert.equal(out.code,200);
 const order=out.body.events.find(x=>x.kind==="order");
 assert.equal(order.validForReview,false);
 assert.equal(out.body.profile.productInterests.length,0);
});
test("duplicate Shopify owners prevent all Gmail disclosure",async()=>{
 setEnvironment();const calls=setupFetch({ambiguous:true});const out=res();
 await handler(req(),out);
 assert.equal(out.code,200);
 assert.equal(out.body.coverage.email,"ambiguous_customer_email");
 assert.equal(out.body.events.some(e=>e.source==="Gmail"),false);
 assert.equal(calls.some(x=>x.includes("gmail.googleapis.com")),false);
});
test("invalid customer ID is rejected before external API calls",async()=>{
 setEnvironment();const calls=setupFetch();const out=res();
 await handler(req("bogus"),out);
 assert.equal(out.code,400);assert.equal(calls.length,0);
});
