"use strict";
// Fail closed until Shopify all-history net USD has been reconciled, sampled,
// approved by finance, and explicitly enabled by the operator.
const POLICY_VERSION="2026-11-12";
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
    !DIGEST.test(String(orders.financialLedgerDigest||"")))
  return block("full_history_financial_ledger_not_verified");
 const digest=orders.financialLedgerDigest;
 // The current #4 audit endpoint intentionally emits AUDIT_ONLY or BLOCKED;
 // neither is an approval for Feishu grade/RFM writes.
 if(audit?.status!=="FINANCE_APPROVED_FOR_CRM_WRITEBACK"||
    audit.policyVersion!==POLICY_VERSION||audit.sourceDigest!==digest||
    audit.orderCoverage?.fullHistory!==true||audit.currencyAudit?.allConvertedToUSD!==true||
    audit.refundAudit?.reconciled!==true||
    !Number.isInteger(audit.sampleAudit?.verifiedCustomers)||audit.sampleAudit.verifiedCustomers<7)
  return block("full_history_financial_audit_not_approved");
 if(approval?.status!=="APPROVED_FOR_CRM_WRITEBACK"||
    approval.policyVersion!==POLICY_VERSION||approval.sourceDigest!==digest||
    typeof approval.approvalId!=="string"||approval.approvalId.length<8||
    typeof approval.approvedBy!=="string"||!approval.approvedBy.trim()||
    !Number.isFinite(Date.parse(approval.approvedAt)))
  return block("finance_owner_approval_missing_or_mismatched");
 return {allowed:true,sourceDigest:digest,approvalId:approval.approvalId};
}
module.exports={checkFinanceWriteback,POLICY_VERSION};
