"use strict";
const crypto=require('node:crypto');
function authorized(req){
 const a=String(process.env.KBI_ACCESS_TOKEN||''),b=String(req.headers?.authorization||'').replace(/^Bearer\s+/i,'');
 return a.length>=24&&!!b&&crypto.timingSafeEqual(crypto.createHash('sha256').update(a).digest(),crypto.createHash('sha256').update(b).digest());
}
function defaults(){return {version:0,items:[
 {id:'goal-month',kind:'goal',title:'当前月 GMV 目标：$100,000',notes:'',done:false,priority:true},
 {id:'goal-week',kind:'goal',title:'最近一周目标：毛利润转正',notes:'实际毛利润待成本数据核验',done:false,priority:true}
]};}
function validItem(x){return x&&/^[a-z0-9_-]{3,70}$/.test(x.id)&&['goal','opportunity','anomaly'].includes(x.kind)&&typeof x.title==='string'&&x.title.trim().length>0&&x.title.length<=300&&typeof x.notes==='string'&&x.notes.length<=3000&&typeof x.done==='boolean'&&typeof x.priority==='boolean';}
module.exports={authorized,defaults,validItem};
