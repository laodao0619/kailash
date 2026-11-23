"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {qaMatchesSnapshot,canReuseQA,REQUIRED_CHECKS,fullChecksPass}=require("../lib/kbi-qa-freshness");
const qa=()=>({version:4,ready:true,at:"2026-11-22T06:00:00Z",sourceSnapshot:snapshot(),checks:Object.fromEntries(REQUIRED_CHECKS.map(name=>[name,true])),metrics:{total:10930}});
const snapshot=()=>({version:2,slot:"2026-11-22-afternoon",generatedAt:"2026-11-22T05:45:25Z",total:10930});
const state=()=>({complete:true,slot:"2026-11-22-afternoon",completedAt:"2026-11-22T05:45:26Z",records:10930});
test("fresh QA with identical snapshot and passed checks is ready",()=>assert.equal(qaMatchesSnapshot(qa(),snapshot()),true));
test("previous index QA does not verify a newer index",()=>assert.equal(qaMatchesSnapshot({...qa(),at:"2026-11-22T04:10:16Z"},snapshot()),false));
test("QA index count mismatch fails closed",()=>assert.equal(qaMatchesSnapshot({...qa(),metrics:{total:10928}},snapshot()),false));
test("a single failed or missing check fails closed",()=>{assert.equal(qaMatchesSnapshot({...qa(),checks:{list:true,sort:false}},snapshot()),false);assert.equal(qaMatchesSnapshot({...qa(),checks:{}},snapshot()),false)});
test("unknown timestamps or missing metadata cannot yield ready",()=>{assert.equal(qaMatchesSnapshot({...qa(),at:null},snapshot()),false);assert.equal(qaMatchesSnapshot(qa(),{total:10930}),false);assert.equal(qaMatchesSnapshot(null,snapshot()),false)});
test("old QA may be reused only for the same completed snapshot",()=>assert.equal(canReuseQA(qa(),state(),snapshot(),Date.parse("2026-11-22T07:00:00Z")),true));
test("a new completed build invalidates a recent QA run",()=>assert.equal(canReuseQA(qa(),{...state(),completedAt:"2026-11-22T06:30:00Z"},snapshot(),Date.parse("2026-11-22T07:00:00Z")),false));
test("different source row counts invalidate cached QA",()=>assert.equal(canReuseQA(qa(),{...state(),records:10932},snapshot(),Date.parse("2026-11-22T07:00:00Z")),false));
test("an in-flight build is not treated as completed",()=>assert.equal(canReuseQA(qa(),{...state(),complete:false},snapshot(),Date.parse("2026-11-22T07:00:00Z")),false));
test("future-dated and expired QA runs are never reusable",()=>{assert.equal(canReuseQA(qa(),state(),snapshot(),Date.parse("2026-11-22T05:00:00Z")),false);assert.equal(canReuseQA(qa(),state(),snapshot(),Date.parse("2026-11-22T10:00:00Z")),false)});
test("invalid completed checkpoint time prevents reuse",()=>assert.equal(canReuseQA(qa(),{...state(),completedAt:"invalid"},snapshot(),Date.parse("2026-11-22T07:00:00Z")),false));
test("partial legacy QA reports cannot claim readiness",()=>{
 const missing=qa();
 delete missing.checks.mailSummary;
 assert.equal(qaMatchesSnapshot(missing,snapshot()),false);
 assert.equal(canReuseQA(missing,state(),snapshot(),Date.parse("2026-11-22T07:00:00Z")),false);
});
test("all twelve real service checks are required",()=>{
 assert.equal(REQUIRED_CHECKS.length,12);
 for(const name of REQUIRED_CHECKS){
  const partial=qa();
  delete partial.checks[name];
  assert.equal(qaMatchesSnapshot(partial,snapshot()),false,name);
 }
});
test("old QA report versions do not qualify even with identical row count",()=>{
 assert.equal(qaMatchesSnapshot({...qa(),version:3},snapshot()),false);
});
test("unknown failed checks cannot be hidden alongside the full required suite",()=>{
 const partial=qa();
 partial.checks.unexpectedNewCheck=false;
 assert.equal(qaMatchesSnapshot(partial,snapshot()),false);
});

test("QA writer fails closed on incomplete or truthy-only service checks",()=>{
 const complete=qa().checks;
 assert.equal(fullChecksPass(complete),true);
 const missing={...complete};delete missing.noteRead;
 assert.equal(fullChecksPass(missing),false);
 assert.equal(fullChecksPass({...complete,sort:"true"}),false);
 assert.equal(fullChecksPass({...complete,extraCheck:false}),false);
});

test("QA report must include exact generation identity, not just total",()=>{
 const older=qa();delete older.sourceSnapshot;
 assert.equal(qaMatchesSnapshot(older,snapshot()),false);
 assert.equal(qaMatchesSnapshot(qa(),{...snapshot(),generatedAt:"2026-11-22T05:50:00Z"}),false);
 assert.equal(qaMatchesSnapshot(qa(),{...snapshot(),slot:"2026-11-23-morning"}),false);
});
test("no PII is captured in persisted snapshot identity",()=>{
 const {snapshotIdentity}=require("../lib/kbi-qa-freshness");
 const stored=snapshotIdentity({...snapshot(),customers:[{email:"secret@example.test"}]});
 assert.deepEqual(Object.keys(stored),["version","slot","generatedAt","total"]);
});
test("in-progress, nonmatching generation cannot prove readiness",()=>{
 const {completedSnapshotMatchesState,sameSnapshot}=require("../lib/kbi-qa-freshness");
 assert.equal(completedSnapshotMatchesState(snapshot(),{...state(),complete:false}),false);
 assert.equal(completedSnapshotMatchesState(snapshot(),{...state(),slot:"2026-11-23-morning"}),false);
 assert.equal(sameSnapshot(snapshot(),{...snapshot(),generatedAt:"2026-11-22T05:45:26Z"}),false);
});

test("public health validates completed checkpoint and QA together",()=>{
 const {qaMatchesCompletedSnapshot}=require("../lib/kbi-qa-freshness");
 assert.equal(qaMatchesCompletedSnapshot(qa(),snapshot(),state()),true);
 assert.equal(qaMatchesCompletedSnapshot(qa(),snapshot(),{...state(),complete:false}),false);
 assert.equal(qaMatchesCompletedSnapshot({...qa(),at:"2026-11-22T05:45:25.500Z"},snapshot(),state()),false);
 assert.equal(qaMatchesCompletedSnapshot(qa(),snapshot(),{...state(),slot:"2026-11-22-noon"}),false);
 assert.equal(qaMatchesCompletedSnapshot(qa(),snapshot(),{...state(),records:10929}),false);
 assert.equal(qaMatchesCompletedSnapshot(qa(),snapshot(),null),false);
});

test("tier-filter QA verifies a non-empty full-index result instead of vacuous every()",()=>{
 const {tierFilterEvidencePass}=require("../lib/kbi-qa-freshness");
 const master={masterTotal:10935,asOf:"2026-11-23T01:20:24Z",slot:"2026-11-23-morning",facets:{tiers:[{value:"S+",count:65},{value:"B",count:1000}]}};
 const page={ok:true,masterTotal:10935,asOf:master.asOf,slot:master.slot,total:65,page:1,pageSize:50,pageCount:2,
  customers:Array.from({length:50},(_,i)=>({id:String(i+1),tier:"S+"}))};
 assert.equal(tierFilterEvidencePass(master,page),true);
 assert.equal(tierFilterEvidencePass(master,{...page,asOf:"2026-11-22T05:45:25Z"}),false,
  "tier filter from a previous private index is never accepted");
 assert.equal(tierFilterEvidencePass(master,{...page,slot:"2026-11-22-afternoon"}),false);
 assert.equal(tierFilterEvidencePass({...master,asOf:null},page),false);
 assert.equal(tierFilterEvidencePass(master,{...page,customers:[...page.customers.slice(1),page.customers[1]]}),false,
  "duplicated customer IDs in the filtered page cannot pass QA");
 assert.equal(tierFilterEvidencePass(master,{...page,customers:[]}),false,
  "empty rows must not satisfy Array.every");
 assert.equal(tierFilterEvidencePass(master,{...page,total:0,customers:[],pageCount:0}),false,
  "a silently ignored tier parameter must not be green");
 assert.equal(tierFilterEvidencePass(master,{...page,total:64,pageCount:2}),false,
  "filtered count must match the whole-source facet");
 assert.equal(tierFilterEvidencePass(master,{...page,masterTotal:10930}),false,
  "mixed index generations must not be green");
 assert.equal(tierFilterEvidencePass(master,{...page,customers:[...page.customers.slice(1),{tier:"B"}]}),false);
 assert.equal(tierFilterEvidencePass({...master,facets:{tiers:[]}},page),false,
  "unknown expected tier count is not proof of filtering");
});


test("cross-page sorted customer index requires consistent metadata and disjoint IDs",()=>{
 const {paginationSortEvidencePass}=require("../lib/kbi-qa-freshness");
 const source={version:2,slot:"2026-11-23-morning",generatedAt:"2026-11-23T01:20:24Z",total:10935};
 const rows=(start)=>Array.from({length:25},(_,i)=>({id:String(start+i),m180:10000-(start+i)}));
 const first={ok:true,page:1,pageSize:25,pageCount:438,total:10935,masterTotal:10935,
  asOf:source.generatedAt,slot:source.slot,customers:rows(1)};
 const second={...first,page:2,customers:rows(26)};
 assert.equal(paginationSortEvidencePass(first,second,source),true);
 assert.equal(paginationSortEvidencePass(first,{...second,customers:first.customers},source),false,
  "repeated page one must fail even when every row is correctly sorted");
 assert.equal(paginationSortEvidencePass(first,{...second,customers:rows(26).reverse()},source),false,
  "unsorted second page must fail");
 assert.equal(paginationSortEvidencePass(first,{...second,asOf:"2026-11-22T05:45:25Z"},source),false);
 assert.equal(paginationSortEvidencePass({...first,masterTotal:10930},second,source),false);
 assert.equal(paginationSortEvidencePass(first,{...second,pageCount:437},source),false);
 assert.equal(paginationSortEvidencePass(first,{...second,customers:second.customers.slice(1)},source),false);
 assert.equal(paginationSortEvidencePass(first,second,{...source,total:10936}),false);
});
test("cross-page QA rejects unknown-first, nonnumeric and duplicate-ID sort evidence",()=>{
 const {paginationSortEvidencePass}=require("../lib/kbi-qa-freshness");
 const source={version:2,slot:"morning",generatedAt:"2026-11-23T01:00:00Z",total:1000};
 const rows=(offset)=>Array.from({length:25},(_,i)=>({id:String(offset+i),m180:500-offset-i}));
 const first={ok:true,page:1,pageSize:25,pageCount:40,total:1000,masterTotal:1000,
  asOf:source.generatedAt,slot:source.slot,customers:rows(1)};
 const second={...first,page:2,customers:rows(26)};
 assert.equal(paginationSortEvidencePass(first,second,source),true);
 assert.equal(paginationSortEvidencePass({...first,customers:first.customers.map(row=>({...row,m180:null}))},second,source),false);
 assert.equal(paginationSortEvidencePass(first,{...second,customers:[{...second.customers[0],m180:"99"},...second.customers.slice(1)]},source),false);
 assert.equal(paginationSortEvidencePass(first,{...second,customers:[{...second.customers[0],id:"1"},...second.customers.slice(1)]},source),false);
 assert.equal(paginationSortEvidencePass(first,{...second,customers:[{...second.customers[0],id:"abc"},...second.customers.slice(1)]},source),false);
});
