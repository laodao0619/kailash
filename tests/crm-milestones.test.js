"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {milestoneFields}=require("../lib/crm-bulk-feishu");
function customer(updated,state="SUBSCRIBED"){
 return {id:"gid://shopify/Customer/123",createdAt:"2025-01-01T00:00:00Z",numberOfOrders:"1",
  orders:{nodes:[{processedAt:"2025-02-01T00:00:00Z",test:false}]},
  defaultEmailAddress:{emailAddress:"person@example.org",marketingState:state,marketingUpdatedAt:updated}};
}
test("first order and signup-time subscription are verified timestamps",()=>{
 const f=milestoneFields(customer("2025-01-01T00:00:00Z"));
 assert.equal(f["首次订阅时间"],Date.parse("2025-01-01T00:00:00Z"));
 assert.equal(f["首次下单时间"],Date.parse("2025-02-01T00:00:00Z"));
});
test("later marketing update never masquerades as first subscription",()=>{
 const f=milestoneFields(customer("2025-10-01T00:00:00Z"));
 assert.equal(f["首次订阅时间"],undefined);
 assert.equal(f["订阅状态更新时间"],Date.parse("2025-10-01T00:00:00Z"));
});
test("unsubscribed is not considered first subscribed",()=>{
 const f=milestoneFields(customer("2025-01-01T00:00:00Z","UNSUBSCRIBED"));
 assert.equal(f["首次订阅时间"],undefined);
});
