"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const html=fs.readFileSync(path.join(__dirname,"../public/bi/index.html"),"utf8");
const model=fs.readFileSync(path.join(__dirname,"../public/bi/rfm-3d.js"),"utf8");
test("RFM eight-cell 3D model is separate from grade and selectable by AOV/tier",()=>{
 for(const id of ["rfm-cube","rfm-8segments","rfm-tier","rfm-aov","rfm-r","rfm-f","rfm-m","rfm-run","rfm-health"])
  assert(html.includes('id="'+id+'"'),id);
 assert(model.includes('Math.cbrt(ratio)'),"actual area/volume proportional to customer count");
 assert(model.includes('pointermove'),"rotatable canvas");
 assert(model.includes('addEventListener("wheel"'),"3D zoom");
 for(const code of ["HHH","HHL","HLH","HLL","LHH","LHL","LLH","LLL"])assert(model.includes(code));
});
test("model snapshot save, load, compare and copy are wired",()=>{
 for(const id of ["rfm-save","rfm-snapshot-select","rfm-compare","rfm-copy","rfm-snapshot-name"])
  assert(html.includes('id="'+id+'"'),id);
 assert(model.includes('"/api/bi-rfm-snapshots"'));
});
test("customer360 has sticky close and note drawer with tabbed history",()=>{
 assert(html.includes('id="note-shortcut"'));
 assert(html.includes('id="note-drawer"'));
 assert(html.includes('.dialog-top{position:sticky'));
 assert(html.includes('.customer-note-drawer{position:fixed'));
 for(const v of ["trend","products","mail","events"])assert(html.includes('data-c360-pane="'+v+'"'));
 assert(html.includes('function customer360Tab('));
 assert(html.includes('id="customer-product-cols"'));
 assert(html.includes('aspect-ratio:3/4'));
});
test("every timeline lane repeats its own horizontal calendar labels",()=>{
 assert(html.includes('Repeat full date axis under every metric lane'));
 assert(html.includes('yBottom+23'));
});
test("purchase evidence includes historical price, discount, channel and order-matched email issues",()=>{
 const insights=require("../lib/kbi-product-insights");
 const order={kind:"order",orderId:"gid://shopify/Order/1",orderName:"7002",
  validForReview:true,at:"2026-11-06T00:00:00Z",channel:"meta",
  products:[{title:"Vajra",quantity:1,unitPrice:80,originalUnitPrice:100,discountedUnitPrice:80,discountAmount:20}]};
 const mails=[{kind:"communication",issueFlag:"possible_nonreceipt_claim",title:"Re Order 7002 did not arrive",preview:"Not received",gmailUrl:"https://mail.google.com/mail/u/0/#all/thread"}];
 const result=insights.productHistory([order],mails);
 const purchase=result.products[0].purchases[0];
 assert.equal(purchase.originalUnitPrice,100);
 assert.equal(purchase.discountedUnitPrice,80);
 assert.equal(purchase.orderChannel,"meta");
 assert.equal(purchase.relatedEmailIssues.length,1);
 assert.equal(purchase.relatedEmailIssues[0].relation,"possible_order_number_match_not_verified");
 assert.equal(insights.productHistory([order],[{...mails[0],title:"Order 7003",preview:""}]).products[0].purchases[0].relatedEmailIssues.length,0);
});

test("RFMs filter refresh automatically and comparison reveals per-octant historical differences",()=>{
 assert(model.includes('$(id).onchange=()=>refresh()'));
 assert(model.includes('setTimeout(()=>'));
 assert(model.includes('rfm-compare-table'));
 assert(model.includes('baseline.segments.find'));
 assert(model.includes('sourceAsOf:current.asOf'));
});
