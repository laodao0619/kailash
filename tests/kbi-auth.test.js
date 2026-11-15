"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {DEFAULT_KBI_ACCESS_TOKEN_MIN_LENGTH,minimumKbiTokenLength,isKbiTokenConfigured}=require("../lib/kbi-auth");

test("KBI token minimum matches the established 24-character authorization floor",()=>{
 assert.equal(DEFAULT_KBI_ACCESS_TOKEN_MIN_LENGTH,24);
 assert.equal(minimumKbiTokenLength({}),24);
 assert.equal(isKbiTokenConfigured("x".repeat(23),{}),false);
 assert.equal(isKbiTokenConfigured("x".repeat(24),{}),true);
 assert.equal(isKbiTokenConfigured(undefined,{}),false);
});
test("KBI minimum can only be raised by environment configuration",()=>{
 const env={KBI_ACCESS_TOKEN_MIN_LENGTH:"32"};
 assert.equal(minimumKbiTokenLength(env),32);
 assert.equal(isKbiTokenConfigured("x".repeat(31),env),false);
 assert.equal(isKbiTokenConfigured("x".repeat(32),env),true);
});
test("a missing, invalid or weakening override preserves the 24-character floor",()=>{
 for(const value of ["","0","-1","1","8","23","2.5","abc"]){
  const env={KBI_ACCESS_TOKEN_MIN_LENGTH:value};
  assert.equal(minimumKbiTokenLength(env),24);
  assert.equal(isKbiTokenConfigured("x".repeat(23),env),false);
 }
});


test("readiness distinguishes absent and below-policy tokens without revealing secrets",()=>{
 const readiness=require("../api/bi-readiness");
 const originalToken=process.env.KBI_ACCESS_TOKEN;
 const originalMinimum=process.env.KBI_ACCESS_TOKEN_MIN_LENGTH;
 const evaluate=(token,minimum)=>{
  if(token===undefined)delete process.env.KBI_ACCESS_TOKEN;
  else process.env.KBI_ACCESS_TOKEN=token;
  if(minimum===undefined)delete process.env.KBI_ACCESS_TOKEN_MIN_LENGTH;
  else process.env.KBI_ACCESS_TOKEN_MIN_LENGTH=minimum;
  const response={setHeader(){},status(code){this.statusCode=code;return this;},json(body){this.body=body;return body;}};
  const result=readiness({method:"GET"},response);
  assert.equal(response.statusCode,200);
  if(token)assert.equal(JSON.stringify(result).includes(token),false);
  return result;
 };
 try{
  const absent=evaluate(undefined,undefined);
  assert.equal(absent.accessReady,false);
  assert.equal(absent.accessBlockReason,"token_missing");
  const short=evaluate("test-short-token",undefined);
  assert.equal(short.accessReady,false);
  assert.equal(short.accessBlockReason,"token_below_security_policy");
  const raised=evaluate("test-preview-credential-1234567890", "40");
  assert.equal(raised.accessReady,false);
  assert.equal(raised.accessBlockReason,"token_below_security_policy");
  const ready=evaluate("test-preview-credential-1234567890",undefined);
  assert.equal(ready.accessReady,true);
  assert.equal(ready.accessBlockReason,null);
  assert.equal(ready.readiness==="access_not_configured",false);
 }finally{
  if(originalToken===undefined)delete process.env.KBI_ACCESS_TOKEN;
  else process.env.KBI_ACCESS_TOKEN=originalToken;
  if(originalMinimum===undefined)delete process.env.KBI_ACCESS_TOKEN_MIN_LENGTH;
  else process.env.KBI_ACCESS_TOKEN_MIN_LENGTH=originalMinimum;
 }
});
