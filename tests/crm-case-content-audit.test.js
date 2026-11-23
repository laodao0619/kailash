"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {auditCaseContentPage} = require("../lib/crm-case-content-audit");
const prefix = "crm-cases/v1/events/";
const blob = n => ({pathname:prefix+n+".json"});

test("audits a bounded private page and returns only aggregate evidence", async () => {
  const calls=[];
  const result = await auditCaseContentPage({pageSize:2,cursor:"page-2",
    listPage: async opts => {calls.push(opts); return {blobs:[blob(3),blob(4)],hasMore:true,cursor:"page-3"};},
    readRecord: async path => ({eventId:"gmail:"+path.split("/").pop(),customerEmail:"private@example.com",originalExcerpt:"secret text"}),
  });
  assert.deepEqual(calls,[{prefix,access:"private",limit:2,cursor:"page-2"}]);
  assert.equal(result.inspectedObjects,2);
  assert.equal(result.legacyWithoutEventId,0);
  assert.equal(result.hasMore,true);
  assert.equal(result.nextCursor,"page-3");
  assert.equal(result.fullArchiveContentVerified,false);
  assert.equal(result.crossPageDuplicateVerified,false);
  assert.equal(result.feishuCoverageVerified,false);
  assert.equal(result.checkpointAdvanced,false);
  assert.match(result.pageFingerprint,/^[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(result).includes("private@example.com"),false);
  assert.equal(JSON.stringify(result).includes("secret text"),false);
  assert.equal(JSON.stringify(result).includes("events/"),false);
});

test("missing private event and duplicate IDs fail closed", async () => {
  const listPage=async()=>({blobs:[blob(1),blob(2)],hasMore:false});
  await assert.rejects(auditCaseContentPage({listPage,readRecord:async()=>null}),/unreadable/);
  await assert.rejects(auditCaseContentPage({listPage,readRecord:async()=>({eventId:"gmail:one"})}),/repeated/);
});

test("missing legacy event IDs are counted, not invented", async () => {
  const result=await auditCaseContentPage({listPage:async()=>({blobs:[blob(1)],hasMore:false}),readRecord:async()=>({source:"Gmail"})});
  assert.equal(result.legacyWithoutEventId,1);
  assert.equal(result.nextCursor,null);
  assert.equal(result.fullArchiveContentVerified,false);
});

test("malformed pagination, cursors and archive paths fail closed", async () => {
  const goodRead=async()=>({eventId:"gmail:1"});
  for (const page of [null,{}, {blobs:[],hasMore:true,cursor:"next"},
    {blobs:[blob(1)],hasMore:true}, {blobs:[blob(1)],hasMore:true,cursor:"old"},
    {blobs:[blob(1),blob(1)],hasMore:false},
    {blobs:[{pathname:"public/a"}],hasMore:false},
    {blobs:[blob(1),blob(2)],hasMore:false}]) {
    await assert.rejects(auditCaseContentPage({cursor:"old",pageSize:1,
      listPage:async()=>page,readRecord:goodRead}));
  }
});

test("invalid limits, wrong prefix and hostile cursors are rejected", async () => {
  for (const args of [{pageSize:0},{pageSize:251},{prefix:"crm-public/"},
    {cursor:"a\npassword"},{cursor:"x".repeat(1025)}]) {
    await assert.rejects(auditCaseContentPage({listPage:async()=>({blobs:[],hasMore:false}),
      readRecord:async()=>({}),...args}),/bounds invalid/);
  }
});
