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
  lineItems:{pageInfo:{hasNextPage:false},nodes:[{title:"Vajra pendant",quantity:1}]},
  customerJourneySummary:{ready:true,
   firstVisit:{occurredAt:"2026-10-06T00:00:00Z",source:"facebook",
    landingPage:"https://store.example.test/item",referrerUrl:null,
    utmParameters:{source:"facebook",medium:"cpc",campaign:"test_campaign"}},
   lastVisit:null}};
}
function setupFetch({duplicate=false,mailDate="2026-11-08T08:51:12Z"}={}){
 let calls=[];
 global.fetch=async(url,options={})=>{
  calls.push(String(url));
  if(String(url).includes("/admin/api/"))return response({data:{customer:{
   id:"gid://shopify/Customer/12345678901",firstName:"Sample",lastName:"Customer",createdAt:"2026-10-02T00:00:00Z",
   numberOfOrders:"1",defaultEmailAddress:{emailAddress:EMAIL,marketingState:"SUBSCRIBED"},
   orders:{pageInfo:{hasNextPage:false},nodes:[shopOrder()]}}}});
  if(String(url).includes("oauth2.googleapis.com/token"))return response({access_token:"test-oauth"});
  if(String(url).includes("/messages?"))return response({messages:[{id:"mail-1"}]});
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
 assert.equal(calls.filter(x=>x.includes("gmail.googleapis.com")).length,2);
});
test("a message from an unexpected sender is never linked",async()=>{
 setEnvironment();const calls=setupFetch({duplicate:true});const out=res();
 await handler(req(),out);
 assert.equal(out.code,200);
 assert.equal(out.body.events.filter(x=>x.kind==="communication").length,0);
});
test("invalid customer ID is rejected before external API calls",async()=>{
 setEnvironment();const calls=setupFetch();const out=res();
 await handler(req("bogus"),out);
 assert.equal(out.code,400);assert.equal(calls.length,0);
});
