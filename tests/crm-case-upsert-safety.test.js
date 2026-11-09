"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const feishu = require("../lib/crm-feishu");
const { upsertCase, TABLE, HUMAN, recordFields } = require("../lib/crm-case-feishu-writeback");

test("existing Case update only sends machine-owned fields and converts multi-select", async () => {
  const originalRequest = feishu.request;
  const originalFind = feishu.findBy;
  const calls = [];
  const c = { caseId: "CASE-ABCDEF123456", category: "物流", priority: "P1", customerEmail: "case@example.invalid" };
  const schema = Object.keys(recordFields(c, 1)).map(field_name => ({
    field_name, type: field_name === "问题类别" ? 4 : field_name === "任务优先级" ? 3 : 1,
    ...(["问题类别","任务优先级"].includes(field_name) ? {property:{options:[{name:"物流查询"},{name:"高"}]}} : {})
  }));
  feishu.findBy = async () => [{ record_id: "rec_existing", fields: { "负责人": "人工负责人", "任务状态": "处理中" } }];
  feishu.request = async (_token, path, method = "GET", body) => {
    calls.push({ path, method, body });
    if (path.includes("/fields?")) return { items: schema, has_more: false };
    return {};
  };
  try {
    assert.equal(await upsertCase("test-token", TABLE, c), "updated");
    const writes = calls.filter(x => x.method !== "GET");
    assert.equal(writes.length, 1);
    assert.equal(writes[0].method, "PATCH");
    assert.ok(writes[0].path.endsWith("/rec_existing"));
    assert.deepEqual(writes[0].body.fields["问题类别"], ["物流查询"]);
    assert.equal(writes[0].body.fields["任务优先级"], "高");
    for (const name of HUMAN) assert.equal(Object.hasOwn(writes[0].body.fields, name), false);
  } finally {
    feishu.request = originalRequest;
    feishu.findBy = originalFind;
  }
});

test("duplicate Case IDs reject without write", async () => {
  const originalFind = feishu.findBy;
  const originalRequest = feishu.request;
  let writes = 0;
  feishu.findBy = async () => [{record_id:"one"},{record_id:"two"}];
  feishu.request = async () => { writes++; return {}; };
  try {
    await assert.rejects(upsertCase("test-token", TABLE, {caseId:"CASE-ABCDEF123456"}), /Duplicate Case ID/);
    assert.equal(writes, 0);
  } finally {
    feishu.findBy = originalFind;
    feishu.request = originalRequest;
  }
});

test("Case write rejects unconfigured select values before POST or PATCH", async () => {
  const originalRequest = feishu.request;
  const originalFind = feishu.findBy;
  const c = { caseId: "CASE-ABCDEF123456", category: "物流", priority: "P1" };
  const schema = Object.keys(recordFields(c, 1)).map(field_name => ({
    field_name,
    type: field_name === "问题类别" ? 4 : field_name === "任务优先级" ? 3 : 1,
    ...(["问题类别", "任务优先级"].includes(field_name)
      ? { property: { options: [{ name: "其他" }, { name: "普通" }] } }
      : {})
  }));
  let writes = 0;
  feishu.findBy = async () => [];
  feishu.request = async (_token, path, method = "GET") => {
    if (method !== "GET") writes++;
    if (path.includes("/fields?")) return { items: schema, has_more: false };
    return {};
  };
  try {
    await assert.rejects(upsertCase("test-token", TABLE, c), /option not configured/);
    assert.equal(writes, 0);
  } finally {
    feishu.request = originalRequest;
    feishu.findBy = originalFind;
  }
});
