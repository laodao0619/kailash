"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {audit}=require("../lib/kbi-rfm-coverage");
test("counts partial M/R/F separately with no purchased-client PII",()=>{
 const rows=[
  {id:"A",ordersLifetime:2,m180:0,f180:0,rDays:220},
  {id:"B",ordersLifetime:1,m180:null,f180:1,rDays:12},
  {id:"C",ordersLifetime:0,m180:0,f180:0,rDays:null},
  {id:"D",ordersLifetime:null,m180:null,f180:null,rDays:null}
 ];
 const result=audit(rows);
 assert.equal(result.total,4);assert.equal(result.complete,1);
 assert.equal(result.incomplete,3);assert.equal(result.completePercent,25);
 assert.equal(result.purchasedCompletePercent,50); // 1 of 2 purchasers complete, not 1 of 4 customers
 assert.deepEqual(result.missing,{m180:2,f180:1,rDays:2,allThree:1});
 assert.equal(result.purchasedRecordsMissingRfm,1);
 assert.equal(result.groups.neverPurchased.incomplete,1);
 assert.equal(JSON.stringify(result).includes('"A"'),false);
});
test("zero values are valid and no data is a truthful null rate",()=>{
 assert.equal(audit([{ordersLifetime:0,m180:0,f180:0,rDays:0}]).complete,1);
 assert.equal(audit([]).completePercent,null);
 assert.equal(audit([]).purchasedCompletePercent,null);
 const onlyNonBuyers=audit([{ordersLifetime:0,m180:0,f180:0,rDays:null}]);
 assert.equal(onlyNonBuyers.purchasedRecordsMissingRfm,0);
 assert.equal(onlyNonBuyers.purchasedCompletePercent,null);
 assert.throws(()=>audit(null),/invalid_customer_index/);
});
test("negative, nonfinite, and noninteger frequency are invalid",()=>{
 const r=audit([{ordersLifetime:1,m180:NaN,f180:1.5,rDays:-1},
   {ordersLifetime:-1,m180:10,f180:1,rDays:10}]);
 assert.equal(r.incomplete,1);
 assert.equal(r.groups.unknownOrderCount.total,1);
 assert.equal(r.missing.allThree,1);
});
