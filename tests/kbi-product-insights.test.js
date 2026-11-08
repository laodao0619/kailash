"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {productHistory,channelOf,mailSummary}=require("../lib/kbi-product-insights");
const prod={title:"Guardian Vajra Thokcha Necklace",quantity:2,productId:"gid://shopify/Product/77",productType:"Necklace",
 description:"Handcrafted protective vajra pendant using Tibetan Thokcha",productUrl:"https://kailashenergy.com/products/vajra",
 imageUrl:"https://cdn.shopify.com/test.jpg",unitPrice:84.5,currency:"USD"};
const order=(id,valid=true)=>({kind:"order",at:"2026-10-10",orderId:"gid://shopify/Order/"+id,
 orderName:"#"+id,validForReview:valid,products:[prod]});
test("product history preserves original product photo, listing URL, paid unit price, order quantity and category",()=>{
 const out=productHistory([order("1"),order("2"),order("3",false)]);
 assert.equal(out.products.length,1);
 const p=out.products[0];
 assert.equal(p.quantity,6);assert.equal(p.validQuantity,4);
 assert.equal(p.validOrders,2);
 assert.equal(p.productUrl,prod.productUrl);
 assert.equal(p.imageUrl,prod.imageUrl);
 assert.equal(p.purchases[0].unitPrice,84.5);
 assert.equal(out.categories[0].label,"Necklace");
 assert(out.preferences.some(x=>x.label.includes("Vajra")));
 assert(out.preferences.every(x=>x.verifiedPreference===false));
});
test("only refunded products do not create preference profile",()=>{
 const out=productHistory([order("4",false)]);
 assert.equal(out.products.length,1);
 assert.equal(out.categories.length,0);
 assert.equal(out.preferences.length,0);
});
test("channel classification respects recorded utm source, not inferred exposure",()=>{
 assert.equal(channelOf({utm:{source:"facebook",medium:"cpc"}}),"meta");
 assert.equal(channelOf({utm:{source:"google",medium:"paid"}}),"google");
 assert.equal(channelOf({utm:{source:"klaviyo"}}),"email");
 assert.equal(channelOf({utm:{source:"pinterest"}}),"pinterest");
 assert.equal(channelOf({utm:{source:"unknown"}}),"unknown");
});
test("mail summary groups one customer thread and never marks a possible issue as verified",()=>{
 const rows=[
  {kind:"communication",threadId:"abc",title:"Re: package",direction:"inbound",at:"2026-11-01",issueFlag:"possible_nonreceipt_claim",preview:"Did not arrive"},
  {kind:"communication",threadId:"abc",title:"Re: package",direction:"outbound",at:"2026-11-02",preview:"We will check"},
  {kind:"communication",threadId:"def",title:"New request",direction:"inbound",at:"2026-11-03"}
 ];
 const x=mailSummary(rows);
 assert.equal(x.messages,3);assert.equal(x.threads,2);
 assert.equal(x.inbound,2);assert.equal(x.outbound,1);assert.equal(x.possibleIssues,1);
 assert.equal(x.conversations[1].issues,1);
 assert.match(x.conversations[1].summary,/人工核验/);
});

test("shipping protection remains in complete historical archive but not jewelry preference analysis",()=>{
 const example={kind:"order",at:"2026-11-06",orderId:"gid://shopify/Order/7002",
  orderName:"7002",validForReview:true,products:[
   {title:"Shipping Protection",quantity:1,productType:"shipping-protection",productId:"shield-1"},
   {title:"Vajra Handmade Necklace",quantity:1,productType:"Necklace",productId:"jewelry-1"}
  ]};
 const result=productHistory([example]);
 assert.equal(result.products.length,2);
 const protection=result.products.find(x=>x.title==="Shipping Protection");
 assert.equal(protection.isService,true);
 assert(!result.categories.some(x=>x.label==="shipping-protection"));
 assert(result.preferences.some(x=>x.label.includes("Vajra")));
});
