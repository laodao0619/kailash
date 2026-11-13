"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { recordFields } = require("../lib/crm-case-feishu-writeback");
const { preflightCaseSchema } = require("../lib/crm-case-schema-preflight");
const cases = require("../lib/crm-cases");
const feishu = require("../lib/crm-feishu");
const writeback = require("../lib/crm-case-feishu-writeback");
const handler = require("../api/crm-cases-schema-preflight");

function approvedSchema() {
  const c = { caseId: "CASE-000000000000", receivedAt: "2026-11-12T00:00:00Z",
    originalUrl: "https://mail.google.com/mail/u/0/#all/synthetic" };
  const names = new Set([...Object.keys(recordFields(c, 0)), "任务状态"]);
  const options = {
    "问题类别": ["物流查询", "产品问题", "退款退货", "补发赠品", "售前咨询", "其他"],
    "任务优先级": ["紧急", "高", "普通"],
    "沟通渠道": ["Gmail"],
    "沟通方向": ["客户发起"],
    "任务状态": ["待处理", "处理中"],
    "CRM等级（Case核验）": ["S+", "S", "A", "B", "沉睡", "从未购买", "待核验"],
  };
  return [...names].map(field_name => ({
    field_name,
    type: field_name === "CRM等级（Case核验）" ? 4
      : options[field_name] ? 3
      : field_name === "邮件数量" ? 2
      : ["记录时间", "最后同步时间"].includes(field_name) ? 5
      : field_name === "是否需要人工处理" ? 7
      : field_name === "原邮件链接" ? 15 : 1,
    ...(options[field_name] ? { property: { options: options[field_name].map(name => ({ name })) } } : {}),
  }));
}
function response() {
  return { code: 200, body: null, headers: {},
    setHeader(k,v) { this.headers[k] = v; },
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; } };
}

test("preflight covers all Case category, priority and CRM grade options with synthetic data only", () => {
  const r = preflightCaseSchema(approvedSchema());
  assert.equal(r.ready, true);
  assert.equal(r.syntheticCasesChecked, 16);
  assert(r.fieldCount >= 20);
});

test("preflight rejects actual single/multi-select shape mismatch", () => {
  const bad = approvedSchema().map(f => f.field_name === "问题类别" ? { ...f, type: 4 } : f);
  assert.throws(() => preflightCaseSchema(bad), /field type mismatch: 问题类别/);
});

test("preflight blocks missing real select options without writing a record", () => {
  const bad = approvedSchema().map(f => f.field_name === "CRM等级（Case核验）"
    ? { ...f, property: { options: [{ name: "待核验" }] } } : f);
  assert.throws(() => preflightCaseSchema(bad), /option not configured/);
});

test("preflight rejects duplicate field definitions", () => {
  const s = approvedSchema();
  assert.throws(() => preflightCaseSchema([...s, s[0]]), /duplicate or invalid/);
});

test("protected live schema probe does not call Feishu without CRON_SECRET authorization", async () => {
  const originalAuthorized = cases.authorized, originalToken = feishu.tenantToken;
  let tokenCalls = 0;
  cases.authorized = () => false;
  feishu.tenantToken = async () => { tokenCalls++; throw Error("unreachable"); };
  try {
    const res = response();
    await handler({ method: "GET", headers: {} }, res);
    assert.equal(res.code, 401);
    assert.equal(tokenCalls, 0);
  } finally { cases.authorized = originalAuthorized; feishu.tenantToken = originalToken; }
});

test("authorized live schema probe reads only, never issues Case POST/PUT or checkpoint writes", async () => {
  const originalAuthorized = cases.authorized, originalToken = feishu.tenantToken;
  const originalEnsure = writeback.ensureTable, originalUpsert = writeback.upsertCase;
  let upserts = 0, schemaReads = 0;
  cases.authorized = () => true;
  feishu.tenantToken = async () => "synthetic-token";
  writeback.ensureTable = async (_t, args) => {
    schemaReads++;
    assert.equal(args.includeSchema, true);
    return { tableId: writeback.TABLE, schema: approvedSchema() };
  };
  writeback.upsertCase = async () => { upserts++; throw Error("must not write"); };
  try {
    const res = response();
    await handler({ method: "GET", headers: {} }, res);
    assert.equal(res.code, 200);
    assert.equal(res.body.mode, "read_only");
    assert.equal(res.body.ready, true);
    assert.equal(res.body.syntheticCasesChecked, 16);
    assert.equal(schemaReads, 1);
    assert.equal(upserts, 0);
    assert.equal(JSON.stringify(res.body).includes("synthetic@example.invalid"), false);
    assert.equal(JSON.stringify(res.body).includes("synthetic-token"), false);
  } finally {
    cases.authorized = originalAuthorized;
    feishu.tenantToken = originalToken;
    writeback.ensureTable = originalEnsure;
    writeback.upsertCase = originalUpsert;
  }
});
