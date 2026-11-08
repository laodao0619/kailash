"use strict";
const SHOPIFY_API_VERSION="2026-10";
const CUSTOMER_QUERY=`query CRMCustomers($cursor:String) {
  customers(first:50,after:$cursor,sortKey:ID) {
    pageInfo{hasNextPage endCursor}
    nodes{
      id firstName lastName createdAt numberOfOrders
      amountSpent{amount currencyCode}
      defaultEmailAddress{emailAddress}
      defaultAddress{country countryCodeV2}
    }
  }
}`;
const ORDER_QUERY=`query CRMOrders($cursor:String,$filter:String!) {
 orders(first:50,after:$cursor,query:$filter,sortKey:PROCESSED_AT) {
  pageInfo{hasNextPage endCursor}
  nodes{
   id processedAt test cancelledAt displayFinancialStatus
   currentSubtotalPriceSet{shopMoney{amount currencyCode}}
   customer{id}
  }
 }
}`;
async function queryShopify(query,variables={}){
 const domain=(process.env.SHOPIFY_SHOP_DOMAIN||"").replace(/^https?:\/\//,"").replace(/\/$/,"");
 const token=process.env.SHOPIFY_ADMIN_ACCESS_TOKEN||"";
 if(!/^[-a-zA-Z0-9.]+\.myshopify\.com$/.test(domain)||!token)throw Error("Shopify backend connection not authorized");
 const r=await fetch("https://"+domain+"/admin/api/"+SHOPIFY_API_VERSION+"/graphql.json",{
 method:"POST",headers:{"X-Shopify-Access-Token":token,"Content-Type":"application/json"},body:JSON.stringify({query,variables})
 });
 const data=await r.json().catch(()=>({}));
 if(!r.ok||data.errors?.length)throw Error("Shopify query failed "+r.status+": "+(data.errors||[]).map(x=>x.message).join(" ").slice(0,180));
 return data.data;
}
async function customers(cursor){
 const d=await queryShopify(CUSTOMER_QUERY,{cursor:cursor||null});
 return d.customers;
}
async function orders(cursor,sinceIso){
 const d=await queryShopify(ORDER_QUERY,{cursor:cursor||null,filter:"processed_at:>="+sinceIso});
 return d.orders;
}
function checkedOrder(o){
 if(o.test||o.cancelledAt)return null;
 if(!["PAID","PARTIALLY_PAID","PARTIALLY_REFUNDED"].includes(o.displayFinancialStatus))return null;
 const money=o.currentSubtotalPriceSet?.shopMoney;
 if(!money||money.currencyCode!=="USD"||!Number.isFinite(Number(money.amount)))
  return {id:o.id,customerId:o.customer?.id,processedAt:o.processedAt,usdNetAmount:null,verified:false};
 return {id:o.id,customerId:o.customer?.id,processedAt:o.processedAt,
 usdNetAmount:Number(money.amount),verified:true};
}
module.exports={customers,orders,checkedOrder,SHOPIFY_API_VERSION};
