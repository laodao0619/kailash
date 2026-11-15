"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {readFileSync}=require("node:fs"),path=require("node:path");
const {checkFinanceWriteback}=require("../lib/crm-finance-writeback-gate");
const digest="a".repeat(64);
const orders={completed:true,sourceType:"full_history_shopify_net_usd",fullHistoryNetUSD:true,
 rolling180dFromSameLedger:true,since:null,financialLedgerDigest:digest};
const customers={shopifyCycleComplete:true};
const audit={status:"FINANCE_APPROVED_FOR_CRM_WRITEBACK",policyVersion:"2026-11-12",sourceDigest:digest,
 orderCoverage:{fullHistory:true},currencyAudit:{allConvertedToUSD:true},refundAudit:{reconciled:true},
 sampleAudit:{verifiedCustomers:7}};
const approval={status:"APPROVED_FOR_CRM_WRITEBACK",policyVersion:"2026-11-12",sourceDigest:digest,
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
