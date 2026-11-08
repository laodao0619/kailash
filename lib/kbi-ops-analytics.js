"use strict";
const SOURCE={
 sales:"FROM sales SHOW total_sales, net_sales, gross_sales, orders, average_order_value TIMESERIES day SINCE -30d UNTIL today",
 summary:"FROM sales SHOW total_sales, net_sales, orders, average_order_value, returning_customer_rate, returning_customers SINCE -30d UNTIL today",
 sessions:"FROM sessions SHOW sessions, conversion_rate TIMESERIES day SINCE -30d UNTIL today",
 funnel:"FROM sessions SHOW sessions, conversion_rate, added_to_cart_rate, reached_checkout_rate SINCE -30d UNTIL today",
 channels:"FROM sales SHOW total_sales, net_sales, orders GROUP BY sales_channel SINCE -30d UNTIL today",
 repeat:"FROM sales SHOW total_sales, orders GROUP BY new_or_returning_customer SINCE -30d UNTIL today",
 attribution:"FROM sales SHOW total_sales, orders GROUP BY referring_channel WITH LAST_CLICK_ATTRIBUTION SINCE -30d UNTIL today LIMIT 70",
 campaigns:"FROM sales SHOW total_sales, orders GROUP BY utm_campaign, utm_source WITH LAST_CLICK_ATTRIBUTION SINCE -30d UNTIL today LIMIT 500",
 products:"FROM sales SHOW net_sales, orders GROUP BY product_title SINCE -30d UNTIL today ORDER BY net_sales DESC LIMIT 12",
 categories:"FROM sales SHOW net_sales, orders GROUP BY product_type SINCE -30d UNTIL today ORDER BY net_sales DESC LIMIT 20"
};
const number=v=>Number.isFinite(Number(v))?Number(v):0;
const round=(v,n=2)=>Math.round(v*10**n)/10**n;
function validate(response,name){
 if(!response||response.parseErrors?.length||!Array.isArray(response.tableData?.rows))
  throw Error("shopifyql_"+name+"_invalid");
 return response.tableData.rows;
}
function emailSource(v){
 return /(?:^|[^a-z])(shopify_email|klaviyo|mailchimp|newsletter|email|gmail)(?:$|[^a-z])/i.test(String(v||""));
}
function build(queries,at=new Date().toISOString()){
 const daily=validate(queries.sales,"sales"),sessions=validate(queries.sessions,"sessions");
 const summary=validate(queries.summary,"summary")[0]||{};
 const funnel=validate(queries.funnel,"funnel")[0]||{};
 const channels=validate(queries.channels,"channels"),repeat=validate(queries.repeat,"repeat");
 const attribution=validate(queries.attribution,"attribution"),campaigns=validate(queries.campaigns,"campaigns");
 const productRows=validate(queries.products,"products"),categoryRows=validate(queries.categories,"categories");
 const totals={totalSales:0,netSales:0,grossSales:0,orders:0,sessions:0,convertedSessions:0};
 const dateMap=new Map();
 for(const d of daily){
  const date=String(d.day||"");if(!/^\d{4}-\d{2}-\d{2}$/.test(date))continue;
  const row={day:date,totalSales:number(d.total_sales),netSales:number(d.net_sales),
   orders:number(d.orders),aov:number(d.average_order_value),sessions:0,conversionRate:null};
  totals.totalSales+=row.totalSales;totals.netSales+=row.netSales;totals.orders+=row.orders;
  totals.grossSales+=number(d.gross_sales);dateMap.set(date,row);
 }
 for(const d of sessions){
  const date=String(d.day||"");const row=dateMap.get(date)||{day:date,totalSales:0,netSales:0,orders:0,aov:0,sessions:0,conversionRate:null};
  row.sessions=number(d.sessions);
  row.conversionRate=Number.isFinite(Number(d.conversion_rate))?Number(d.conversion_rate):null;
  totals.sessions+=row.sessions;
  if(row.conversionRate!==null)totals.convertedSessions+=row.sessions*row.conversionRate;
  dateMap.set(date,row);
 }
 const allChannels=channels.map(c=>({name:String(c.sales_channel||"未注明"),gmv:round(number(c.total_sales)),
  net:round(number(c.net_sales)),orders:number(c.orders)})).sort((a,b)=>b.gmv-a.gmv);
 const validChannelTotal=allChannels.reduce((x,y)=>x+y.gmv,0);
 for(const c of allChannels)c.share=validChannelTotal?round(c.gmv/validChannelTotal*100):0;
 const loyal=repeat.map(c=>({type:String(c.new_or_returning_customer||"Unknown"),
  gmv:round(number(c.total_sales)),orders:number(c.orders)}));
 const returning=loyal.find(x=>x.type.toLowerCase()==="returning")||{gmv:0,orders:0};
 const newOrders=loyal.find(x=>x.type.toLowerCase()==="new")||{gmv:0,orders:0};
 const classifiedGmv=loyal.reduce((s,x)=>s+x.gmv,0);
 const classifiedOrders=loyal.reduce((s,x)=>s+x.orders,0);
 const touchChannels=attribution.map(c=>({name:String(c.referring_channel||"未注明"),
  gmv:round(number(c.total_sales__last_click)),orders:number(c.orders__last_click)})).sort((a,b)=>b.gmv-a.gmv);
 const emailCampaigns=campaigns.filter(c=>emailSource(c.utm_source)).map(c=>({
  campaign:String(c.utm_campaign||"未注明营销活动").slice(0,160),source:String(c.utm_source||""),
  attributedGmv:round(number(c.total_sales__last_click)),attributedOrders:number(c.orders__last_click)
 })).sort((a,b)=>b.attributedGmv-a.attributedGmv);
 return {version:1,generatedAt:at,period:"past_30_days_including_today",currency:"shop_currency",
  metrics:{
   gmv:round(totals.totalSales),netSales:round(totals.netSales),grossSales:round(totals.grossSales),
   orders:round(totals.orders,0),sessions:round(totals.sessions,0),
   conversionRate:totals.sessions?round(totals.convertedSessions/totals.sessions*100,3):null,
   aov:Number.isFinite(Number(summary.average_order_value))?round(number(summary.average_order_value)):null,
   repeatCustomerRate:Number.isFinite(Number(summary.returning_customer_rate))?round(number(summary.returning_customer_rate)*100,2):null,
   returningCustomers:number(summary.returning_customers),
   addedToCartRate:Number.isFinite(Number(funnel.added_to_cart_rate))?round(number(funnel.added_to_cart_rate)*100,3):null,
   reachedCheckoutRate:Number.isFinite(Number(funnel.reached_checkout_rate))?round(number(funnel.reached_checkout_rate)*100,3):null,
   convertedSessions:round(number(funnel.sessions)*number(funnel.conversion_rate),0),
   addedToCartSessions:round(number(funnel.sessions)*number(funnel.added_to_cart_rate),0),
   reachedCheckoutSessions:round(number(funnel.sessions)*number(funnel.reached_checkout_rate),0),
   returningGmvShare:classifiedGmv?round(returning.gmv/classifiedGmv*100):null,
   returningOrderShare:classifiedOrders?round(returning.orders/classifiedOrders*100):null,
   newGmv:newOrders.gmv,returningGmv:returning.gmv,
   emailAttributedGmv:round(emailCampaigns.reduce((s,c)=>s+c.attributedGmv,0)),
   emailAttributedOrders:emailCampaigns.reduce((s,c)=>s+c.attributedOrders,0)
  },daily:[...dateMap.values()].sort((a,b)=>a.day.localeCompare(b.day)),
  channelSales:allChannels,returningBreakdown:loyal,touchAttribution:touchChannels,
  emailCampaigns,
  topProducts:productRows.map(x=>({name:String(x.product_title||"未分类"),netSales:round(number(x.net_sales)),orders:number(x.orders)})),
  productCategories:categoryRows.map(x=>({name:String(x.product_type||"未分类"),netSales:round(number(x.net_sales)),orders:number(x.orders)})),
  warnings:[
   "GMV uses Shopify total_sales; net_sales includes Shopify report-specific adjustments and differs from ledger net cash.",
   "Conversion rate is session-weighted from Shopify sessions, not orders divided by sessions.",
   "AOV proxy is net_sales / sales orders; compare against native Shopify AOV when present.",
   "Returning customer rate is ShopifyQL returning_customer_rate. Returning order and GMV shares use a different denominator.",
   "Email GMV uses Shopify last-click UTM attribution within 30 days, not Gmail sender interactions or delivery/send records."
  ],dataSources:{sales:"ShopifyQL sales",traffic:"ShopifyQL sessions",
   channelSales:"ShopifyQL sales_channel",returning:"ShopifyQL new_or_returning_customer",
   attribution:"ShopifyQL LAST_CLICK_ATTRIBUTION"}};
}
function dateRange(start,end){
 const valid=x=>typeof x==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&!Number.isNaN(Date.parse(x))&&new Date(x).toISOString().slice(0,10)===x;
 if(!valid(start)||!valid(end)||start>end||(Date.parse(end)-Date.parse(start))/86400000>365)throw Error("invalid_date_range");
 return {start,end};
}
function queryBatch(range){
 const fields=Object.entries(SOURCE).map(([key,q])=>key+':shopifyqlQuery(query:'+JSON.stringify(range?q.replace("SINCE -30d UNTIL today","SINCE "+dateRange(range.start,range.end).start+" UNTIL "+range.end):q.replace("SINCE -30d", "SINCE -29d"))+'){parseErrors parseWarnings tableData{columns{name} rows}}').join("\n");
 return 'query KbiOperationsReport{'+fields+'}';
}
module.exports={build,SOURCE,queryBatch,emailSource,dateRange};
