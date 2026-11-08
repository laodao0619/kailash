"use strict";
/**
 * CRM source-quality classification. No writes to Shopify.
 * Suspicious paid profiles are excluded from the shared CRM pending manual verification.
 * Marketing consent is taken ONLY from Shopify's current email marketingState.
 */
const BLOCKED_DOMAINS=new Set([
 "qq.com","qq.com.cn","fakemail.com","example.com","example.org","example.net",
 "test.com","mailinator.com","guerrillamail.com","yopmail.com",
 "10minutemail.com","tempmail.com","temp-mail.org","discard.email",
 "fakeinbox.com","trashmail.com","sharklasers.com"
]);
const BOT_NAMES=/^(?:google\s*store\s*bot|google\s*storebot|store\s*bot|test(?:\s*test)?|demo(?:\s*order)?|dummy|fake|sample|test\s*order|automation\s*test)$/i;
function classify(c){
 const email=(c.defaultEmailAddress?.emailAddress||"").trim().toLowerCase();
 const orderCount=Math.max(0,Number(c.numberOfOrders)||0);
 const fullName=[c.firstName,c.lastName].filter(Boolean).join(" ").trim();
 const rawState=c.defaultEmailAddress?.marketingState||"NOT_SUBSCRIBED";
 let problem="";
 if(!email||!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)||c.defaultEmailAddress?.validFormat===false)problem="无有效邮箱";
 else{
  const [local,domain]=email.split("@");
  if(BLOCKED_DOMAINS.has(domain)||domain.endsWith(".invalid"))problem=domain.startsWith("qq.")?"QQ邮箱":"测试或临时邮箱";
  else if(/^fake\d{3,}$/.test(local)||/^(?:test|demo|fake|bot)[\d._+-]*$/.test(local))problem="机器人或测试邮箱";
  else if(BOT_NAMES.test(fullName)||/^(?:\d{1,3}\s*){2,}$/.test(fullName))problem="测试或机器人姓名";
 }
 if(problem)return {eligible:false,reason:problem,paidManualReview:orderCount>0,rawState};
 // Shopify's consent status is authoritative; do not infer subscribed from order count.
 const labels={SUBSCRIBED:"已订阅",NOT_SUBSCRIBED:"未订阅",UNSUBSCRIBED:"已退订",PENDING:"待确认",INVALID:"邮箱无效"};
 const status=labels[rawState]||"待确认";
 if(status==="邮箱无效")return {eligible:false,reason:"Shopify标记邮箱无效",paidManualReview:orderCount>0,rawState};
 return {eligible:true,reason:"",paidManualReview:false,rawState,subscription:status,email};
}
module.exports={classify};
