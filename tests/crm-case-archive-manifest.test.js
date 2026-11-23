"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {auditCaseArchive} = require("../lib/crm-case-archive-manifest");
const prefix = "crm-cases/v1/events/";
const blob = n => ({pathname:prefix+n+".json"});

test("metadata-only audit reaches final page beyond old 500-event window", async()=>{
  const pages=[];
  const result = await auditCaseArchive({pageSize:500,listPage:async ({cursor,prefix:requested,access,limit})=>{
    assert.equal(requested,prefix);assert.equal(access,"private");assert.equal(limit,500);
    pages.push(cursor||"first");
    return cursor ? {blobs:[blob("501"),blob("502")],hasMore:false} :
      {blobs:Array.from({length:500},(_,i)=>blob(String(i))),hasMore:true,cursor:"p2"};
  }});
  assert.deepEqual(pages,["first","p2"]);
  assert.equal(result.eventObjectCount,502);
  assert.equal(result.pageCount,2);
  assert.equal(result.fullArchiveListingVerified,true);
  assert.equal(result.feishuCoverageVerified,false);
  assert.match(result.listingFingerprint,/^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(result).includes("crm-cases/"),false);
});

test("duplicate paths across pages block manifest completion",async()=>{
  await assert.rejects(auditCaseArchive({listPage:async({cursor})=>cursor?
    {blobs:[blob("a")],hasMore:false}:
    {blobs:[blob("a")],hasMore:true,cursor:"next"}}),/repeated/);
});

test("missing, malformed and truncated page flags fail closed",async()=>{
  for(const page of [null,{}, {blobs:[blob("a")]}, {blobs:[],hasMore:true,cursor:"next"},
    {blobs:[{pathname:"public/event"}],hasMore:false}]) {
    await assert.rejects(auditCaseArchive({listPage:async()=>page}));
  }
});

test("cyclic cursors and page exhaustion never report verified archive",async()=>{
  await assert.rejects(auditCaseArchive({listPage:async()=>({blobs:[blob("a")],hasMore:true,cursor:"same"})}),/pagination invalid|repeated/);
  let calls=0;
  await assert.rejects(auditCaseArchive({maxPages:2,listPage:async()=>({blobs:[blob(String(calls++))],hasMore:true,cursor:"cursor-"+calls})}),/safety limit/);
});

test("audit requires bounded private archive prefix and valid page limits",async()=>{
  for(const args of [{prefix:"public/"},{pageSize:0},{pageSize:1001},{maxPages:0},{maxPages:51}]) {
    await assert.rejects(auditCaseArchive({listPage:async()=>({blobs:[],hasMore:false}),...args}),/bounds invalid/);
  }
});
