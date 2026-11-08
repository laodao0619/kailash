"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {Readable}=require("node:stream");
const {mock}=require("node:test");
const blob=require("@vercel/blob");
let storage=null;
const getMock=mock.method(blob,"get",async()=>storage?{
 statusCode:200,stream:Readable.from([Buffer.from(storage,"utf8")])}:null);
const putMock=mock.method(blob,"put",async(_path,body)=>{storage=String(body);return{url:"private://saved"}});
const handler=require("../api/bi-customer-note");
const old=process.env.KBI_ACCESS_TOKEN;
const secret="test-customer-note-access-token-long";
process.env.KBI_ACCESS_TOKEN=secret;
function request(method,id,body,auth=secret){return {method,query:{id},
 headers:{authorization:"Bearer "+auth},body};}
function response(){return {code:200,data:null,setHeader(){},status(n){this.code=n;return this;},json(d){this.data=d;return this;}}}
test.after(()=>{
 getMock.mock.restore();putMock.mock.restore();
 if(old===undefined)delete process.env.KBI_ACCESS_TOKEN;
 else process.env.KBI_ACCESS_TOKEN=old;
});
test("customer notes reject unauthorized reads and writes",async()=>{
 const a=response();await handler(request("GET","1234567",null,"invalid"),a);
 assert.equal(a.code,401);
 const b=response();await handler(request("PUT","1234567",{text:"secret",version:0},"invalid"),b);
 assert.equal(b.code,401);
});
test("note path protects against traversal and invalid customer ids",()=>{
 assert.equal(handler.pathFor("../../confidential"),null);
 assert.equal(handler.pathFor("gid://shopify/Customer/123"),null);
 assert.equal(handler.pathFor("1234567"),"kbi-customer-notes/v1/customer-1234567.json");
});
test("note persists and can be reopened with version, stale edits do not overwrite",async()=>{
 storage=null;
 let a=response();await handler(request("GET","1234567"),a);
 assert.equal(a.code,200);assert.equal(a.data.version,0);assert.equal(a.data.text,"");
 let saved=response();await handler(request("PUT","1234567",{text:"Next follow-up after delivery",version:0}),saved);
 assert.equal(saved.code,200);assert.equal(saved.data.version,1);
 a=response();await handler(request("GET","1234567"),a);
 assert.equal(a.data.text,"Next follow-up after delivery");assert.equal(a.data.version,1);
 const duplicate=response();await handler(request("PUT","1234567",{text:"overwrite",version:0}),duplicate);
 assert.equal(duplicate.code,409);
 const reread=response();await handler(request("GET","1234567"),reread);
 assert.equal(reread.data.text,"Next follow-up after delivery");
});
test("oversized notes are rejected without mutating saved text",async()=>{
 const x=response();await handler(request("PUT","1234567",{text:"x".repeat(10001),version:1}),x);
 assert.equal(x.code,400);
 assert.match(storage,/Next follow-up/);
});
