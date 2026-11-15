"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {readFileSync}=require("node:fs"),path=require("node:path");
const {checkFinanceWriteback,projectAuditedLedger,digestAuditedLedger,DIGEST_SCHEME}=require("../lib/crm-finance-writeback-gate");
const {customerValues}=require("../lib/crm-order-aggregate");
const digest="a".repeat(64);
const orders={completed:true,sourceType:"full_history_shopify_net_usd",fullHistoryNetUSD:true,
 rolling180dFromSameLedger:true,since:null,financialLedgerDigest:digest,financialLedgerDigestScheme:DIGEST_SCHEME,page:2,ledgerAsOf:"2026-11-16T00:00:00Z"};
const customers={shopifyCycleComplete:true};
const audit={status:"FINANCE_APPROVED_FOR_CRM_WRITEBACK",policyVersion:"2026-11-12",sourceDigest:digest,digestScheme:DIGEST_SCHEME,sourceAsOf:orders.ledgerAsOf,
 orderCoverage:{fullHistory:true},currencyAudit:{allConvertedToUSD:true},refundAudit:{reconciled:true},
 sampleAudit:{verifiedCustomers:7}};
const approval={status:"APPROVED_FOR_CRM_WRITEBACK",policyVersion:"2026-11-12",sourceDigest:digest,digestScheme:DIGEST_SCHEME,
 approvalId:"approved-20261116",approvedBy:"finance-owner",approvedAt:"2026-11-16T00:00:00Z"};
const run=(overrides={})=>checkFinanceWriteback({orders,customers,audit,approval,manualFlag:"true",...overrides});
test("completed rolling-180d source and current PR4 AUDIT_ONLY never authorize Feishu writeback",()=>{
 assert.equal(run({orders:{...orders,since:"2026-05-01",sourceType:"rolling_180d"}}).allowed,false);
 assert.equal(run({orders:{...orders,fullHistoryNetUSD:false}}).reason,"full_history_financial_ledger_not_verified");
 assert.equal(run({audit:{...audit,status:"AUDIT_ONLY_NOT_APPROVED_FOR_RFM"}}).allowed,false);
 assert.equal(run({audit:{...audit,status:"BLOCKED_FINANCIAL_EVIDENCE_INCOMPLETE"}}).allowed,false);
});
test("missing explicit owner switch and missing evidence block even if snapshots completed",()=>{
 assert.equal(run({manualFlag:undefined}).reason,"finance_writeback_not_approved_by_operator");
 assert.equal(run({customers:{}}).allowed,false);
 assert.equal(run({orders:{...orders,completed:false}}).allowed,false);
 assert.equal(run({audit:null}).allowed,false);
 assert.equal(run({approval:null}).allowed,false);
});
test("mismatched ledger, incomplete refunds/currency or fewer than seven verified customers block",()=>{
 assert.equal(run({audit:{...audit,sourceDigest:"b".repeat(64)}}).allowed,false);
 assert.equal(run({orders:{...orders,financialLedgerDigestScheme:undefined}}).allowed,false);
 assert.equal(run({audit:{...audit,digestScheme:"legacy"}}).allowed,false);
 assert.equal(run({approval:{...approval,digestScheme:"legacy"}}).allowed,false);
 assert.equal(run({approval:{...approval,sourceDigest:"b".repeat(64)}}).allowed,false);
 assert.equal(run({audit:{...audit,refundAudit:{reconciled:false}}}).allowed,false);
 assert.equal(run({audit:{...audit,currencyAudit:{allConvertedToUSD:false}}}).allowed,false);
 assert.equal(run({audit:{...audit,sampleAudit:{verifiedCustomers:6}}}).allowed,false);
});
test("only synthetic, fully matched manual evidence meets future gate contract",()=>{
 assert.deepEqual(run(),{allowed:true,sourceDigest:digest,approvalId:"approved-20261116"});
});
test("reconcile route enforces finance gate before reading checkpoint, manifest or Feishu",()=>{
 const src=readFileSync(path.join(__dirname,"../api/crm-orders-reconcile.js"),"utf8");
 const check=src.indexOf("const gate=checkFinanceWriteback(");
 const state=src.indexOf("const state=await read(STATE)");
 const manifest=src.indexOf("let manifest=await read(MANIFEST)");
 const feishu=src.indexOf("await feishu.tenantToken()");
 assert.ok(check>0&&state>check&&manifest>state&&feishu>manifest);
 assert.match(src,/if\(!gate\.allowed\)return res\.status\(200\)\.json\(\{ok:true,waiting:true,blocked:true/);
 assert.match(src,/reason:"stale_reconciliation_manifest"/);
 assert.match(src,/reason:"stale_reconciliation_checkpoint"/);
});

test("missing audited page count or changed ledger cutoff always fails closed",()=>{
 assert.equal(run({orders:{...orders,page:0}}).reason,"audited_ledger_projection_missing_or_stale");
 assert.equal(run({orders:{...orders,ledgerAsOf:null}}).allowed,false);
 assert.equal(run({audit:{...audit,sourceAsOf:"2026-11-15T00:00:00Z"}}).allowed,false);
});
test("all-history customer lifetime USD cannot be mistaken for rolling 180d M or F",()=>{
 const cid="gid://shopify/Customer/123",asOf="2026-11-16T00:00:00Z";
 const rows=[
  {id:"gid://shopify/Order/old",customerId:cid,processedAt:"2025-01-05T00:00:00Z",usdNetAmount:3000},
  {id:"gid://shopify/Order/new",customerId:cid,processedAt:"2026-11-01T00:00:00Z",usdNetAmount:20}
 ];
 const projection=projectAuditedLedger(rows,{asOf});
 assert.deepEqual({lifetime:projection.lifetime.get(cid).m,lifetimeF:projection.lifetime.get(cid).f,
  recentM:projection.recent.get(cid).m,recentF:projection.recent.get(cid).f},
  {lifetime:3020,lifetimeF:2,recentM:20,recentF:1});
 const value=customerValues({lifetimeSpendUSD:projection.lifetime.get(cid).m,
  lifetimeOrders:projection.lifetime.get(cid).f,lastOrderAt:projection.lifetime.get(cid).last},
  projection.recent.get(cid),{now:projection.asOf});
 assert.equal(value.grade,"S+");
 assert.equal(value.m,20);
 assert.equal(value.f,1);
});
test("unverifiable ledger rows reject projection rather than silently dropping orders",()=>{
 const valid={id:"gid://shopify/Order/1",customerId:"gid://shopify/Customer/1",
  processedAt:"2026-11-01T00:00:00Z",usdNetAmount:20};
 const runProjection=rows=>projectAuditedLedger(rows,{asOf:orders.ledgerAsOf});
 assert.throws(()=>runProjection([]),/Invalid audited ledger projection inputs/);
 assert.throws(()=>runProjection([valid,{...valid}]),/Invalid or duplicated audited order identity/);
 assert.throws(()=>runProjection([{...valid,processedAt:"2026-12-01T00:00:00Z"}]),/Invalid audited order value or timestamp/);
 assert.throws(()=>runProjection([{...valid,usdNetAmount:-1}]),/Invalid audited order value or timestamp/);
 assert.throws(()=>runProjection([{...valid,usdNetAmount:0}]),/Invalid audited order value or timestamp/);
 assert.throws(()=>runProjection([{...valid,customerId:""}]),/Invalid or duplicated audited order identity/);
});
test("reconcile never uses full-history summaries as rolling-180d values",()=>{
 const src=readFileSync(path.join(__dirname,"../api/crm-orders-reconcile.js"),"utf8");
 assert.match(src,/projectAuditedLedger\(all,\{asOf:orders\.ledgerAsOf\}\)/);
 assert.match(src,/const lifetimeSpendUSD=history\?\.m/);
 assert.match(src,/recent\.get\(c\.id\)/);
 assert.doesNotMatch(src,/const summaries=summarize\(all\)/);
});

test("audited ledger digest is order-independent and binds identities, dates, USD cents and cutoff",()=>{
 const asOf="2026-11-16T00:00:00.000Z";
 const a={id:"gid://shopify/Order/1",customerId:"gid://shopify/Customer/1",processedAt:"2026-11-01T00:00:00Z",usdNetAmount:40.23};
 const b={id:"gid://shopify/Order/2",customerId:"gid://shopify/Customer/2",processedAt:"2025-01-01T00:00:00Z",usdNetAmount:19.01};
 const h=digestAuditedLedger([a,b],{asOf});
 assert.match(h,/^[a-f0-9]{64}$/);
 assert.equal(digestAuditedLedger([b,a],{asOf}),h);
 for(const changed of [{...a,usdNetAmount:40.24},{...a,customerId:b.customerId},{...a,processedAt:"2026-11-02T00:00:00Z"}])
  assert.notEqual(digestAuditedLedger([changed,b],{asOf}),h);
 assert.notEqual(digestAuditedLedger([a,b],{asOf:"2026-11-17T00:00:00Z"}),h);
 assert.throws(()=>digestAuditedLedger([a,{...a}],{asOf}),/Duplicated audited ledger/);
 assert.throws(()=>digestAuditedLedger([{...a,usdNetAmount:0.005}],{asOf}),/cents/);
 assert.throws(()=>digestAuditedLedger([{...a,usdNetAmount:0}],{asOf}),/cents/);
});
