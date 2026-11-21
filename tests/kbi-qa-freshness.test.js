"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {verifiedForSnapshot,canReuseRecentQa}=require("../lib/kbi-qa-freshness");

const oldQa={version:4,ready:true,at:"2026-11-21T00:05:17.079Z",
 metrics:{total:10918}};
const current={generatedAt:"2026-11-21T01:20:25.373Z",total:10922};
const rechecked={...oldQa,at:"2026-11-21T01:30:00.000Z",metrics:{total:10922}};

test("reject green QA from earlier snapshot when new index has 4 more records",()=>{
 assert.equal(verifiedForSnapshot(oldQa,current),false);
 assert.equal(canReuseRecentQa(oldQa,current,Date.parse("2026-11-21T03:00:00Z")),false);
});
test("reject green QA from earlier snapshot even if customer count is unchanged",()=>{
 assert.equal(verifiedForSnapshot({...oldQa,metrics:{total:10922}},current),false);
});
test("accept same-snapshot QA and reuse within four hours only",()=>{
 assert.equal(verifiedForSnapshot(rechecked,current),true);
 assert.equal(canReuseRecentQa(rechecked,current,Date.parse("2026-11-21T02:00:00Z")),true);
 assert.equal(canReuseRecentQa(rechecked,current,Date.parse("2026-11-21T05:30:00Z")),false);
});
test("fail closed on unknown timestamps, uncompleted build and unknown record counts",()=>{
 assert.equal(verifiedForSnapshot({ready:true,at:"bad",metrics:{total:10922}},current),false);
 assert.equal(verifiedForSnapshot(rechecked,{generatedAt:"bad",total:10922}),false);
 assert.equal(verifiedForSnapshot(rechecked,{generatedAt:current.generatedAt,total:null}),false);
 assert.equal(canReuseRecentQa(rechecked,null,Date.parse("2026-11-21T02:00:00Z")),false);
 assert.equal(canReuseRecentQa(rechecked,current,Date.parse("2026-11-21T01:00:00Z")),false);
});
test("never treat failed QA or mismatched counts as current verified",()=>{
 assert.equal(verifiedForSnapshot({...rechecked,ready:false},current),false);
 assert.equal(verifiedForSnapshot({...rechecked,metrics:{total:10921}},current),false);
});
