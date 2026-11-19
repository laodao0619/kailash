"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const feishu = require("../lib/crm-feishu");

// Test with synthetic Bitable responses. No Feishu credentials or network.
async function searchFixture(data, run) {
 const originalFetch = globalThis.fetch;
 const calls = [];
 globalThis.fetch = async (url, options) => {
  calls.push({url:String(url),method:options?.method});
  assert.match(String(url), /\/records\/search\?page_size=5$/);
  assert.equal(options?.method,"POST");
  return {ok:true,status:200,json:async()=>({code:0,data})};
 };
 try { await run(calls); } finally { globalThis.fetch = originalFetch; }
}

test("strict identity search accepts only explicit complete Feishu results", async () => {
 await searchFixture({items:[],has_more:false}, async calls => {
  assert.deepEqual(await feishu.findBy("fake-token","synthetic-table","数据来源ID","gmail:synthetic",{requireComplete:true}),[]);
  assert.equal(calls.length,1);
 });
 await searchFixture({items:[{record_id:"synthetic-rec"}],has_more:false}, async () => {
  const rows=await feishu.findBy("fake-token","synthetic-table","数据来源ID","gmail:synthetic",{requireComplete:true});
  assert.equal(rows.length,1);
 });
});

test("truncated, absent, and malformed response metadata block strict identity lookup", async () => {
 for (const data of [
  {items:[{record_id:"synthetic-rec"}],has_more:true,page_token:"synthetic-next"},
  {items:[{record_id:"synthetic-rec"}]},
  {items:null,has_more:false},
 ]) {
  await searchFixture(data,async () => {
   await assert.rejects(
    feishu.findBy("fake-token","synthetic-table","邮箱","synthetic@example.invalid",{requireComplete:true}),
    /Feishu identity lookup incomplete/
   );
  });
 }
});

test("Gmail upsert never creates or updates records after truncated identity search", async () => {
 await searchFixture({items:[{record_id:"synthetic-existing"}],has_more:true,page_token:"next"},async calls => {
  await assert.rejects(feishu.upsertGmail("fake-token",{
   id:"synthetic-message",threadId:"synthetic-thread",date:"2026-11-20T00:00:00Z"
  }),/Feishu identity lookup incomplete/);
  assert.equal(calls.length,1);
  assert.equal(calls[0].method,"POST");
 });
});

test("legacy read-only lookup remains backward compatible until its own migration", async () => {
 await searchFixture({items:[{record_id:"synthetic-rec"}]},async () => {
  const rows=await feishu.findBy("fake-token","synthetic-table","邮箱","synthetic@example.invalid");
  assert.equal(rows.length,1);
 });
});
