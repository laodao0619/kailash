"use strict";

// No remote calls and no customer identifiers in the public diagnostic.
// Seven merchant-selected IDs and their Shopify source order counts are
// required before a full-history audit can scan a private archive.
const CUSTOMER_ID=/^gid:\/\/shopify\/Customer\/[1-9]\d*$/;
function financeAuditConfiguration(env={}) {
  const idsRaw=typeof env.CRM_FINANCE_SAMPLE_CUSTOMER_IDS==="string"
    ?env.CRM_FINANCE_SAMPLE_CUSTOMER_IDS:"";
  const ids=idsRaw.split(",").map(x=>x.trim()).filter(Boolean);
  const idsValid=ids.length===7&&new Set(ids).size===7&&ids.every(id=>CUSTOMER_ID.test(id));
  let counts={};
  let countsValid=false;
  try {
    const raw=env.CRM_FINANCE_SAMPLE_EXPECTED_ORDER_COUNTS;
    const decoded=typeof raw==="string"&&raw.trim()?JSON.parse(raw):null;
    if(decoded&&typeof decoded==="object"&&!Array.isArray(decoded)){
      const entries=Object.entries(decoded);
      countsValid=idsValid&&entries.length===7&&entries.every(([id,n])=>
        ids.includes(id)&&Number.isSafeInteger(n)&&n>=0
      );
      if(countsValid)counts=decoded;
    }
  } catch {
    // Invalid JSON is a blocker, never a recoverable zero count.
  }
  const blockers=[];
  if(!idsValid)blockers.push("seven_valid_unique_customer_ids");
  if(!countsValid)blockers.push("seven_verified_source_order_counts");
  return {
    ready:idsValid&&countsValid,
    customerIds:idsValid?ids:[],
    expectedOrderCounts:counts,
    diagnostic:{
      status:idsValid&&countsValid?"CONFIG_READY_AUDIT_NOT_APPROVED":"BLOCKED_FINANCE_SAMPLE_CONFIGURATION",
      configuredSampleCount:ids.length,
      customerIdsValid:idsValid,
      sourceOrderCountsValid:countsValid,
      blockers,
      containsCustomerData:false,
    },
  };
}
module.exports={financeAuditConfiguration};
