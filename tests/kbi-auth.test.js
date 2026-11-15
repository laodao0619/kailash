"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {DEFAULT_KBI_ACCESS_TOKEN_MIN_LENGTH,minimumKbiTokenLength,isKbiTokenConfigured}=require("../lib/kbi-auth");

test("KBI token minimum defaults to 8 characters",()=>{
 assert.equal(DEFAULT_KBI_ACCESS_TOKEN_MIN_LENGTH,8);
 assert.equal(minimumKbiTokenLength({}),8);
 assert.equal(isKbiTokenConfigured("12345678",{}),true);
 assert.equal(isKbiTokenConfigured("1234567",{}),false);
});
test("KBI token minimum can be configured through the environment",()=>{
 const env={KBI_ACCESS_TOKEN_MIN_LENGTH:"10"};
 assert.equal(minimumKbiTokenLength(env),10);
 assert.equal(isKbiTokenConfigured("1234567890",env),true);
 assert.equal(isKbiTokenConfigured("123456789",env),false);
});
test("invalid KBI minimum length configuration falls back to 8",()=>{
 for(const value of ["","0","-1","2.5","abc"]){
  assert.equal(minimumKbiTokenLength({KBI_ACCESS_TOKEN_MIN_LENGTH:value}),8);
 }
});
