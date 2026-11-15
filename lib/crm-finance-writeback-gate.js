"use strict";
// Fail closed until Shopify all-history net USD has been reconciled, sampled,
// approved by finance, and explicitly enabled by the operator.
const {summarize}=require("./crm-order-aggregate");
const crypto=require("node:crypto");
const DIGEST_SCHEME="kbi-audited-order-projection-v1";
const POLICY_VERSION="2026-11-12";
const DAY_MS=86400000;
const DIGEST=/^[0-9a-f]{64}$/i;
function checkFinanceWriteback({orders,customers,audit,approval,manualFlag}={}){
 const block=reason=>({allowed:false,reason});
 if(manualFlag!=="true")return block("finance_writeback_not_approved_by_operator");
 if(!customers?.shopifyCycleComplete)return block("customer_snapshot_incomplete");
 if(!orders?.completed)return block("order_snapshot_incomplete");
 // orders-stage was originally a rolling 180-day snapshot. Completion alone
 // does NOT make it an audited all-history financial ledger.
 if(orders.sourceType!=="full_history_shopify_net_usd"||orders.fullHistoryNetUSD!==true||
    orders.rolling180dFromSameLedger!==true||orders.since!==null||
    !DIGEST.test(String(orders.financialLedgerDigest||""))||
    orders.financialLedgerDigestScheme!==DIGEST_SCHEME)
  return block("full_history_financial_ledger_not_verified");
 if(!Number.isInteger(orders.page)||orders.page<1||
    !Number.isFinite(Date.parse(orders.ledgerAsOf||""))||
    audit?.sourceAsOf!==orders.ledgerAsOf)
  return block("audited_ledger_projection_missing_or_stale");
 const digest=orders.financialLedgerDigest;
 // The current #4 audit endpoint intentionally emits AUDIT_ONLY or BLOCKED;
 // neither is an approval for Feishu grade/RFM writes.
 if(audit?.status!=="FINANCE_APPROVED_FOR_CRM_WRITEBACK"||
    audit.policyVersion!==POLICY_VERSION||audit.sourceDigest!==digest||
    audit.digestScheme!==DIGEST_SCHEME||
    audit.orderCoverage?.fullHistory!==true||audit.currencyAudit?.allConvertedToUSD!==true||
    audit.refundAudit?.reconciled!==true||
    !Number.isInteger(audit.sampleAudit?.verifiedCustomers)||audit.sampleAudit.verifiedCustomers<7)
  return block("full_history_financial_audit_not_approved");
 if(approval?.status!=="APPROVED_FOR_CRM_WRITEBACK"||
    approval.policyVersion!==POLICY_VERSION||approval.sourceDigest!==digest||
    approval.digestScheme!==DIGEST_SCHEME||
    typeof approval.approvalId!=="string"||approval.approvalId.length<8||
    typeof approval.approvedBy!=="string"||!approval.approvedBy.trim()||
    !Number.isFinite(Date.parse(approval.approvedAt)))
  return block("finance_owner_approval_missing_or_mismatched");
 return {allowed:true,sourceDigest:digest,approvalId:approval.approvalId};
}
// Derive both lifetime dollars and rolling-180d M/F from the same audited rows.
// Never relabel a full-history sum as rolling-180d activity.
function projectAuditedLedger(rows,{asOf,windowDays=180}={}){
 const end=Date.parse(asOf||"");
 if(!Array.isArray(rows)||rows.length===0||
    !Number.isFinite(end)||!Number.isInteger(windowDays)||windowDays<1)
  throw Error("Invalid audited ledger projection inputs");
 const seen=new Set(),recent=[],start=end-windowDays*DAY_MS;
 for(const order of rows){
  if(typeof order?.id!=="string"||!order.id||
     typeof order.customerId!=="string"||!order.customerId||
     seen.has(order.id))throw Error("Invalid or duplicated audited order identity");
  seen.add(order.id);
  const at=Date.parse(order.processedAt||"");
  if(!Number.isFinite(at)||at>end||
     // Only effective, positive-net orders may contribute to F. Fully refunded
     // or zero-merchandise orders belong in raw audit evidence, not CRM M/F.
     !Number.isFinite(order.usdNetAmount)||order.usdNetAmount<=0)
   throw Error("Invalid audited order value or timestamp");
  if(at>=start)recent.push(order);
 }
 return {lifetime:summarize(rows),recent:summarize(recent),asOf:new Date(end)};
}

// Digest the exact audited projection rows that will feed CRM grading, not just
// metadata attached to a stage. Ordering of source pages must not change it.
// A future PR4 exporter must generate this same versioned digest, then finance
// must independently verify raw JSONL/transactions and sign this projection.
// This function is NOT a substitute for financial audit or approval.
function digestAuditedLedger(rows,{asOf}={}){
 if(!Array.isArray(rows)||!rows.length||!Number.isFinite(Date.parse(asOf||"")))
  throw Error("Invalid audited ledger digest inputs");
 const normalized=rows.map(order=>{
  if(typeof order?.id!=="string"||!/^gid:\/\/shopify\/Order\/\d+$/.test(order.id)||
     typeof order.customerId!=="string"||!/^gid:\/\/shopify\/Customer\/\d+$/.test(order.customerId))
   throw Error("Invalid audited ledger digest identity");
  const at=Date.parse(order.processedAt||"");
  const cents=Math.round(order.usdNetAmount*100);
  if(!Number.isFinite(at)||at>Date.parse(asOf)||
     !Number.isFinite(order.usdNetAmount)||!Number.isSafeInteger(cents)||
     cents<=0||Math.abs(order.usdNetAmount*100-cents)>1e-7)
   throw Error("Invalid audited ledger digest timestamp or cents");
  return [order.id,order.customerId,new Date(at).toISOString(),cents];
 });
 normalized.sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0);
 for(let i=1;i<normalized.length;i++)if(normalized[i][0]===normalized[i-1][0])
  throw Error("Duplicated audited ledger digest order ID");
 const payload=JSON.stringify({scheme:DIGEST_SCHEME,asOf:new Date(asOf).toISOString(),rows:normalized});
 return crypto.createHash("sha256").update(payload,"utf8").digest("hex");
}
module.exports={checkFinanceWriteback,projectAuditedLedger,digestAuditedLedger,DIGEST_SCHEME,POLICY_VERSION};
