"use strict";
const crypto=require("node:crypto");
const {snapshot,queryRows}=require("./bi-customers-v2");
function authorized(req){
 const expected=String(process.env.KBI_ACCESS_TOKEN||"");
 const actual=String(req.headers?.authorization||"").replace(/^Bearer\s+/i,"");
 return expected.length>=24&&!!actual&&crypto.timingSafeEqual(
  crypto.createHash("sha256").update(expected).digest(),
  crypto.createHash("sha256").update(actual).digest());
}
function cell(input){
 let value=String(input??"");
 // Prevent spreadsheet formula execution from imported customer-controlled text.
 if(/^[\s]*[=+\-@]/.test(value))value="'"+value;
 return '"'+value.replace(/"/g,'""')+'"';
}
function toCSV(rows){
 const keys=[
  ["id","Shopify客户编号"],["name","客户姓名"],["email","邮箱"],["country","国家地区"],
  ["tier","客户等级(2026-11-12新规则暂算)"],["m180","近180天净消费(历史快照USD)"],
  ["f180","近180天有效订单数(历史快照)"],["rDays","最近购买天数R(历史快照)"],
  ["spendLifetime","历史累计消费USD"],["ordersLifetime","历史订单数"],
  ["aov","平均客单价USD"],["subscription","邮件订阅状态"],["quality","客户数据状态"],
  ["customerStatus","客户关系状态"],["lastOrderAt","最近下单时间(北京时间)"],
  ["firstSubscribedAt","首次订阅记录(北京时间)"],["nextAction","下一步行动"]
 ];
 const day=x=>x?new Date(x).toLocaleString("sv-SE",{timeZone:"Asia/Shanghai"}):"";
 return "\ufeff"+keys.map(k=>cell(k[1])).join(",")+"\r\n"+
  rows.map(r=>keys.map(([name])=>{
   const val=r[name];
   return cell(name.endsWith("At")?day(val):val);
  }).join(",")).join("\r\n");
}
module.exports=async(req,res)=>{
 res.setHeader("Cache-Control","private, no-store");
 res.setHeader("X-Content-Type-Options","nosniff");
 if(req.method!=="GET")return res.status(405).json({ok:false,error:"method"});
 if(!authorized(req))return res.status(401).json({ok:false,error:"unauthorized"});
 try{
  const data=await snapshot();
  const rows=queryRows(data.customers,req.query||{});
  if(rows.length>30000)return res.status(413).json({ok:false,error:"export_too_large"});
  const csv=toCSV(rows);
  res.setHeader("Content-Type","text/csv; charset=utf-8");
  res.setHeader("Content-Disposition",'attachment; filename="kailash-crm-customers-'+new Date().toISOString().slice(0,10)+'.csv"');
  return res.status(200).send(csv);
 }catch(_){return res.status(503).json({ok:false,error:"customer_index_unavailable"});}
};
module.exports.cell=cell;
module.exports.toCSV=toCSV;
