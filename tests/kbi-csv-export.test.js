"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {cell,toCSV}=require("../api/bi-customers-export");
const {queryRows}=require("../api/bi-customers-v2");
test("export escapes line breaks, double quotes and spreadsheet formulas",()=>{
 assert.equal(cell('A"B'),'"A""B"');
 assert.equal(cell("=2+2"),'"\'=2+2"');
 assert.equal(cell("+cmd"),'"\'+cmd"');
 assert.equal(cell("safe"),'"safe"');
});
test("export preserves whole matched set, not one 40-row page",()=>{
 const rows=Array.from({length:112},(_,i)=>({
  id:String(1000+i),name:"Client "+i,email:"buyer"+i+"@example.test",
  tier:i%2?"S+":"B",m180:i%2?3200:60,rDays:i%2?5:60,f180:i%2?5:1,
  spendLifetime:i%2?7000:60,ordersLifetime:i%2?9:1
 }));
 const matched=queryRows(rows,{tier:"S+",sort:"spendLifetime",dir:"desc"});
 assert.equal(matched.length,56);
 const csv=toCSV(matched);
 assert(csv.startsWith("\ufeff"));
 assert.equal(csv.split("\r\n").length,57);
 assert(csv.includes("客户等级(暂算 历史消费及180天购买)"));
 assert(csv.includes("Client 111"));
 assert(!csv.includes("Client 110"));
});

test("export recalculates stale grades and always marks financial status provisional",()=>{
 const csv=toCSV([
  {id:"1",tier:"S+",spendLifetime:0,ordersLifetime:3,f180:1,rDays:20,tierVerified:true,tierAuditStatus:"verified"},
  {id:"2",tier:"S+",spendLifetime:900,ordersLifetime:2,f180:1,rDays:20,tierVerified:true},
  {id:"3",tier:"B",spendLifetime:0,ordersLifetime:0,f180:0}
 ],{asOf:"2026-11-24T01:20:25.901Z"});
 const lines=csv.split("\r\n");
 assert(lines[0].includes("财务审计状态"));
 assert(lines[0].includes("数据快照时间UTC"));
 assert(lines[1].includes('"待核验","2026-11-12","provisional_feishu_snapshot","false","2026-11-24T01:20:25.901Z"'));
 assert(lines[2].includes('"A","2026-11-12","provisional_feishu_snapshot","false"'));
 assert(lines[3].includes('"从未购买","2026-11-12","provisional_feishu_snapshot","false"'));
});
