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
