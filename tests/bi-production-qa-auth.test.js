"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const Module=require("node:module");

test("missing or short KBI token does not overwrite production QA or inspect private Blob",async()=>{
  const file=require.resolve("../api/bi-production-qa");
  const oldLoad=Module._load;
  const oldCron=process.env.CRON_SECRET;
  const oldToken=process.env.KBI_ACCESS_TOKEN;
  let blobReads=0,blobWrites=0,internalCalls=0;
  try{
    // Import the REAL route with isolated synthetic dependencies. No external
    // requests, customer data, secrets, or production writes occur.
    Module._load=function(request,parent,isMain){
      if(request==="@vercel/blob")return {
        get:async()=>{blobReads++;throw Error("unexpected Blob read");},
        put:async()=>{blobWrites++;throw Error("unexpected Blob write");}
      };
      if(parent?.filename===file&&/^\.\/bi-/.test(request)){
        return async()=>{internalCalls++;throw Error("unexpected customer API call");};
      }
      return oldLoad.apply(this,arguments);
    };
    delete require.cache[file];
    const handler=require(file);
    Module._load=oldLoad;
    process.env.CRON_SECRET="synthetic-cron-only-for-local-tests";
    for(const token of [null,"short-token","x".repeat(23)]){
      if(token===null)delete process.env.KBI_ACCESS_TOKEN;
      else process.env.KBI_ACCESS_TOKEN=token;
      const response={
        statusCode:200,body:null,
        setHeader(){},
        status(code){this.statusCode=code;return this;},
        json(data){this.body=data;return this;}
      };
      await handler({
        method:"GET",
        headers:{authorization:"Bearer synthetic-cron-only-for-local-tests"}
      },response);
      assert.equal(response.statusCode,503);
      assert.deepEqual(response.body,{ok:false,error:"login_not_configured"});
      assert.equal(JSON.stringify(response.body).includes("short-token"),false);
    }
    assert.equal(blobReads,0);
    assert.equal(blobWrites,0);
    assert.equal(internalCalls,0);
  }finally{
    Module._load=oldLoad;
    delete require.cache[file];
    if(oldCron===undefined)delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET=oldCron;
    if(oldToken===undefined)delete process.env.KBI_ACCESS_TOKEN;
    else process.env.KBI_ACCESS_TOKEN=oldToken;
  }
});
