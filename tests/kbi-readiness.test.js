"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const handler=require("../api/bi-readiness");
function invoke(method="GET"){
 const headers={};
 const res={statusCode:200,body:null,setHeader(k,v){headers[k]=v;},status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;}};
 handler({method},res);
 return {status:res.statusCode,body:res.body,headers};
}
test("readiness distinguishes absent, insufficient, and valid credentials without leaking values",()=>{
 const previous=process.env.KBI_ACCESS_TOKEN;
 try{
  for(const [value,configuration,ready] of [
   [null,"missing",false],
   ["x".repeat(23),"below_minimum",false],
   ["y".repeat(24),"configured",true],
  ]){
   if(value===null)delete process.env.KBI_ACCESS_TOKEN;
   else process.env.KBI_ACCESS_TOKEN=value;
   const response=invoke();
   assert.equal(response.status,200);
   assert.equal(response.body.accessConfiguration,configuration);
   assert.equal(response.body.accessReady,ready);
   assert.equal(response.headers["Cache-Control"],"no-store");
   assert.equal(response.headers["X-Content-Type-Options"],"nosniff");
   assert.equal(response.body.readiness,ready?response.body.customerSourceReady?"login_available":"data_source_not_configured":"access_not_configured");
   assert(!JSON.stringify(response.body).includes(value||"not-present-secret"),"must not disclose credential");
  }
 }finally{
  if(previous===undefined)delete process.env.KBI_ACCESS_TOKEN;
  else process.env.KBI_ACCESS_TOKEN=previous;
 }
});
test("non-GET readiness remains blocked",()=>{
 assert.equal(invoke("POST").status,405);
});
