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
let cachedToken=null;
let cachedUntil=0;
async function getShopifyToken(domain) {
 const staticToken=process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
 if(staticToken) return staticToken;
 const clientId=process.env.SHOPIFY_CLIENT_ID;
 const clientSecret=process.env.SHOPIFY_CLIENT_SECRET;
 if(!clientId || !clientSecret) throw Error("Shopify client credentials not configured");
 if(cachedToken && Date.now() < cachedUntil) return cachedToken;
 const response=await fetch("https://"+domain+"/admin/oauth/access_token",{
  method:"POST",
  headers:{"Content-Type":"application/x-www-form-urlencoded"},
  body:new URLSearchParams({grant_type:"client_credentials",client_id:clientId,client_secret:clientSecret})
 });
 const data=await response.json().catch(()=>({}));
 if(!response.ok || !data.access_token) {
  throw Error("Shopify client credentials token request failed: "+response.status+" / "+String(data.error||data.error_description||data.errors||"unknown").replace(/[A-Za-z0-9_\\-]{36,}/g,"[redacted]").slice(0,180));
 }
 cachedToken=data.access_token;
 cachedUntil=Date.now()+Math.max(60,Number(data.expires_in||3600)-300)*1000;
 return cachedToken;
}
async function queryShopify(query,variables={}){
 const domain=(process.env.SHOPIFY_SHOP_DOMAIN||"").replace(/^https?:\/\//,"").replace(/\/$/,"");
 if(!/^[-a-zA-Z0-9.]+\.myshopify\.com$/.test(domain))throw Error("Shopify shop domain is invalid");
 const token=await getShopifyToken(domain);
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
