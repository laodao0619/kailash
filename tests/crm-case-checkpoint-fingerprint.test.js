"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {archiveFingerprint,checkpointForArchive} = require("../lib/crm-case-checkpoint-integrity");
const cases = require("../lib/crm-cases");
const feishu = require("../lib/crm-feishu");
const writeback = require("../lib/crm-case-feishu-writeback");
const handler = require("../api/crm-cases-feishu");

// Synthetic Case identities only. These are not real CRM customer records.
const row = (id, options={}) => ({
  caseId: "CASE-" + id, priority:"P1", receivedAt:"2026-11-23T00:00:00Z",
  messageCount:1, eventIds:["gmail:synthetic-"+id], ...options,
});
const original = [row("111111111111"),row("222222222222"),row("333333333333")];
const saved = {offset:1, sourceFingerprint:archiveFingerprint(original)};
test("stable ordered Case window can safely resume a nonzero checkpoint",()=>{
 const result=checkpointForArchive(saved,original);
 assert.equal(result.ok,true);
 assert.equal(result.offset,1);
 assert.equal(result.fingerprint,saved.sourceFingerprint);
});
test("new email can reorder same-count Case window and must block position reuse",()=>{
 const changed=[original[2],original[0],original[1]];
 assert.equal(changed.length,original.length);
 assert.equal(checkpointForArchive(saved,changed).blockedReason,"case_archive_window_changed");
});
test("a new email on the same Case invalidates a nonzero position",()=>{
 const changed=original.map((r,i)=>i===0?{...r,messageCount:2,
  eventIds:[...r.eventIds,"gmail:new-synthetic"]}:r);
 assert.equal(checkpointForArchive(saved,changed).blockedReason,"case_archive_window_changed");
});
test("legacy nonzero offset without source identity is not silently trusted",()=>{
 assert.equal(checkpointForArchive({offset:1},original).blockedReason,"case_archive_window_changed");
});
test("zero offset may safely adopt a changed archive window",()=>{
 const changed=[...original].reverse();
 const state=checkpointForArchive({offset:0,sourceFingerprint:saved.sourceFingerprint},changed);
 assert.equal(state.ok,true);
 assert.equal(state.offset,0);
 assert.equal(state.fingerprint,archiveFingerprint(changed));
 assert.notEqual(state.fingerprint,saved.sourceFingerprint);
});
test("malformed, missing and out-of-range checkpoints fail closed",()=>{
 for(const offset of [-1,1.5,Number.NaN,99,"1",null]){
  assert.equal(checkpointForArchive({offset},original).blockedReason,"case_checkpoint_invalid");
 }
});
test("duplicate or malformed Case IDs cannot produce a valid checkpoint",()=>{
 assert.throws(()=>archiveFingerprint([original[0],original[0]]),/identity invalid/);
 assert.throws(()=>archiveFingerprint([{caseId:"customer@example.invalid"}]),/identity invalid/);
 assert.throws(()=>archiveFingerprint(null),/archive unavailable/);
});
test("stored checkpoint fingerprint is SHA256 and does not contain customer data",()=>{
 const event=[row("ABCDEF123456",{customerEmail:"secret@example.invalid",
   originalExcerpt:"Private customer text"})];
 const fingerprint=archiveFingerprint(event);
 assert.match(fingerprint,/^[a-f0-9]{64}$/);
 assert.equal(fingerprint.includes("secret"),false);
 assert.equal(fingerprint.includes("Private"),false);
});

test("HTTP Case writer rejects drift before touching Feishu rows or advancing checkpoint",async()=>{
 const originals={
  authorized:cases.authorized, allEvents:cases.allEvents,groupCases:cases.groupCases,
  read:cases.read,save:cases.save,tenantToken:feishu.tenantToken,
  ensureTable:writeback.ensureTable,preflightCaseBatch:writeback.preflightCaseBatch,
  upsertCase:writeback.upsertCase,
 };
 const prevEnv=process.env.VERCEL_ENV;
 let writes=0,checkpoints=0;
 try{
  process.env.VERCEL_ENV="production";
  cases.authorized=()=>true;
  cases.allEvents=async()=>[...original].reverse();
  cases.groupCases=ev=>ev;
  cases.read=async()=>saved;
  cases.save=async()=>{checkpoints++;};
  feishu.tenantToken=async()=> "synthetic-token";
  writeback.ensureTable=async()=>({tableId:writeback.TABLE,schema:[]});
  writeback.preflightCaseBatch=batch=>batch.length;
  writeback.upsertCase=async()=>{writes++;return "created";};
  const response={statusCode:200,body:null,setHeader(){},
   status(status){this.statusCode=status;return this;},
   json(payload){this.body=payload;return this;}};
  await handler({method:"GET"},response);
  assert.equal(response.statusCode,409);
  assert.equal(response.body.blockedReason,"case_archive_window_changed");
  assert.equal(response.body.checkpointAdvanced,false);
  assert.equal(response.body.processed,0);
  assert.equal(writes,0);
  assert.equal(checkpoints,0);
 }finally{
  if(prevEnv===undefined)delete process.env.VERCEL_ENV;else process.env.VERCEL_ENV=prevEnv;
  for(const [key,value] of Object.entries(originals)){
   if(key==="tenantToken")feishu.tenantToken=value;
   else if(["ensureTable","preflightCaseBatch","upsertCase"].includes(key))writeback[key]=value;
   else cases[key]=value;
  }
 }
});
