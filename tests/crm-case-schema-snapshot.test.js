"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const feishu = require("../lib/crm-feishu");
const { ensureTable, upsertCase, recordFields, EXTRA, HUMAN, TABLE, NAME } = require("../lib/crm-case-feishu-writeback");

const sample = {
  caseId: "CASE-123456789ABC",
  customerEmail: "sample@example.invalid",
  category: "未收到货",
  priority: "P1",
  messageCount: 2,
};
function approvedSchema() {
  const names = new Set([...Object.keys(recordFields(sample, 1000)), ...EXTRA.map(f => f.field_name), "任务状态"]);
  const select = {
    "问题类别": { type: 3, choices: ["物流查询"] },
    "任务优先级": { type: 3, choices: ["高"] },
    "沟通渠道": { type: 3, choices: ["Gmail"] },
    "沟通方向": { type: 3, choices: ["客户发起"] },
    "任务状态": { type: 3, choices: ["待处理"] },
    "CRM等级（Case核验）": { type: 4, choices: ["S+","待核验"] },
  };
  return [...names].map(field_name => {
    const s = select[field_name];
    if (s) return {
      field_name, type: s.type,
      property: { options: s.choices.map(name => ({ name })) },
    };
    return { field_name, type: field_name === "邮件数量" ? 2 : 1 };
  });
}
function stubFeishu(schema, existing = false) {
  const originalRequest = feishu.request, originalFind = feishu.findBy;
  let schemaReads = 0;
  const writes = [];
  feishu.findBy = async () => existing ? [{ record_id: "rec-existing" }] : [];
  feishu.request = async (_token, path, method = "GET", body) => {
    if (path.endsWith("/tables?page_size=100")) {
      return { items: [{ table_id: TABLE, name: NAME }], has_more: false };
    }
    if (path.endsWith("/fields?page_size=100")) {
      schemaReads++;
      return { items: schema, has_more: false };
    }
    if (method === "POST" || method === "PUT") {
      writes.push({ method, path, body });
      return { record_id: "rec-new" };
    }
    throw Error("Unexpected Feishu request " + method + " " + path);
  };
  return {
    writes,
    countSchemaReads: () => schemaReads,
    restore: () => { feishu.request = originalRequest; feishu.findBy = originalFind; },
  };
}

test("one verified Case schema snapshot is reused for a 2-record batch and serializes actual selects", async () => {
  const stub = stubFeishu(approvedSchema());
  try {
    const { tableId, schema } = await ensureTable("fake-token", { includeSchema: true });
    assert.equal(tableId, TABLE);
    assert.equal(await upsertCase("fake-token", tableId, sample, schema), "created");
    assert.equal(await upsertCase("fake-token", tableId,
      { ...sample, caseId: "CASE-ABCDEF123456" }, schema), "created");
    assert.equal(stub.countSchemaReads(), 1);
    assert.equal(stub.writes.length, 2);
    for (const call of stub.writes) {
      assert.equal(call.method, "POST");
      assert.equal(call.body.fields["问题类别"], "物流查询");
      assert.equal(call.body.fields["沟通渠道"], "Gmail");
      assert.equal(call.body.fields["任务优先级"], "高");
      assert.equal(call.body.fields["沟通方向"], "客户发起");
      assert.deepEqual(call.body.fields["CRM等级（Case核验）"], ["待核验"]);
      assert.equal(call.body.fields["任务状态"], "待处理");
    }
  } finally { stub.restore(); }
});

test("request-local schema supports official PUT without mutating human-owned fields", async () => {
  const stub = stubFeishu(approvedSchema(), true);
  try {
    const { tableId, schema } = await ensureTable("fake-token", { includeSchema: true });
    assert.equal(await upsertCase("fake-token", tableId, sample, schema), "updated");
    assert.equal(stub.countSchemaReads(), 1);
    assert.equal(stub.writes.length, 1);
    assert.equal(stub.writes[0].method, "PUT");
    for (const key of HUMAN) {
      assert.equal(Object.hasOwn(stub.writes[0].body.fields, key), false);
    }
  } finally { stub.restore(); }
});

test("unconfigured CRM grade multi-select option blocks all Case writes even with validated snapshot", async () => {
  const schema = approvedSchema().map(f => f.field_name === "CRM等级（Case核验）"
    ? { ...f, property: { options: [{ name: "A" }] } } : f);
  const stub = stubFeishu(schema);
  try {
    const { tableId, schema: snapshot } = await ensureTable("fake-token", { includeSchema: true });
    await assert.rejects(upsertCase("fake-token", tableId, sample, snapshot), /select option not configured/);
    assert.equal(stub.writes.length, 0);
  } finally { stub.restore(); }
});
