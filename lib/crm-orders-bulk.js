"use strict";

// Shopify Bulk Operations produce an export; they do not mutate customer data.
// Retain order-level and line-item-level facts separately for later reconciliation.
const BULK_QUERY=`{
  orders(sortKey: PROCESSED_AT) {
    edges { node {
      id name createdAt processedAt updatedAt test cancelledAt
      displayFinancialStatus
      customer { id }
      currencyCode
      subtotalPriceSet { shopMoney { amount currencyCode } }
      currentSubtotalPriceSet { shopMoney { amount currencyCode } }
      totalRefundedSet { shopMoney { amount currencyCode } }
      currentTotalPriceSet { shopMoney { amount currencyCode } }
      transactions { id kind status amountSet { shopMoney { amount currencyCode } } }
      lineItems {
        edges { node {
          id title quantity originalUnitPriceSet { shopMoney { amount currencyCode } }
          discountedTotalSet { shopMoney { amount currencyCode } }
          variant { id sku }
          product { id title vendor tags description }
        } }
      }
    } }
  }
}`;

async function start(queryShopify){
 const data=await queryShopify(`mutation StartCrmBulk($query:String!){
  bulkOperationRunQuery(query:$query){ bulkOperation{id status} userErrors{field message} }
 }`,{query:BULK_QUERY});
 const result=data?.bulkOperationRunQuery;
 if(!result||result.userErrors?.length||!result.bulkOperation?.id)
  throw Error("Shopify bulk start rejected: "+(result?.userErrors||[]).map(x=>x.message).join("; ").slice(0,180));
 return result.bulkOperation;
}

async function poll(queryShopify,id){
 const data=await queryShopify(`query CrmBulkStatus($id:ID!){
  node(id:$id){ ... on BulkOperation {id status errorCode objectCount rootObjectCount fileSize url completedAt} }
 }`,{id});
 if(!data?.node||data.node.id!==id)throw Error("Shopify bulk operation not found");
 return data.node;
}

function downloadUrl(raw){
 const url=new URL(raw);
 if(url.protocol!=="https:"||url.username||url.password||url.port)throw Error("Invalid bulk download URL");
 // Shopify signs downloads on Google's storage host. Avoid arbitrary redirects/hosts.
 if(!["storage.googleapis.com","storage.cloud.google.com"].includes(url.hostname))
  throw Error("Unexpected Shopify bulk download host");
 return url;
}

function isExplicitBulkExportEnabled(env=process.env){
 return env?.CRM_FINANCE_BULK_ENABLED==="true";
}
module.exports={BULK_QUERY,start,poll,downloadUrl,isExplicitBulkExportEnabled};
