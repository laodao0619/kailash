"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {productTags}=require("../lib/kbi-customer-profile");
const order=(id,products,extra={})=>({
 kind:"order",orderId:"gid://shopify/Order/"+id,validForReview:true,products,...extra});
test("product interests are grounded in purchased product titles and exact order evidence",()=>{
 const found=productTags([
  order(1,[{title:"Vajra Protection Thokcha Necklace",quantity:1}]),
  order(2,[{title:"Silver Vajra Bracelet",quantity:2}])
 ]);
 const vajra=found.find(x=>x.label==="Vajra");
 assert.equal(vajra.evidenceCount,2);
 assert.equal(vajra.quantity,3);
 assert.equal(vajra.verifiedPreference,false);
 assert.equal(vajra.evidence[0].orderId,"gid://shopify/Order/1");
});
test("exclude refunded/cancelled or unverified purchase events",()=>{
 const found=productTags([
  order(1,[{title:"Turquoise Necklace",quantity:1}],{validForReview:false}),
  {kind:"communication",products:[{title:"Turquoise",quantity:2}]}
 ]);
 assert.equal(found.length,0);
});
test("multiple line items in one order count as one evidence order",()=>{
 const tags=productTags([order(2,[{title:"Vajra Ring",quantity:1},{title:"Vajra Pendant",quantity:2}])]);
 const v=tags.find(x=>x.label==="Vajra");
 assert.equal(v.evidenceCount,1);
 assert.equal(v.quantity,3);
});
test("do not infer location, faith or identity from product purchases",()=>{
 const tags=productTags([order(3,[{title:"Tibetan Lotus Mala",quantity:1}])]);
 assert(tags.some(x=>x.label==="Lotus"));
 assert(tags.some(x=>x.label==="Mala"));
 assert(tags.every(x=>!["religion","income","ethnicity","location"].includes(x.label)));
});
