"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const feishu = require("../lib/crm-feishu");
const writer = require("../lib/crm-case-feishu-writeback");

const input = { caseId: "CASE-0123456789AB", customerEmail: "synthetic@example.test" };
const choiceOptions = {
  "CRM等级（Case核验）": ["待核验"],
  "问题类别": ["其他"],
  "任务优先级": ["普通"],
  "沟通渠道": ["Gmail"],
  "沟通方向": ["客户发起"],
  "任务状态": ["待处理"],
};
const fields = [...Object.keys(writer.recordFields(input, 0)), "任务状态"].map(name => {
  const values = choiceOptions[name];
  return {
    field_name: name,
    type: name === "CRM等级（Case核验）" ? 4
      : values ? 3 : name === "邮件数量" ? 2 : 1,
    ...(values ? { property: { options: values.map(x => ({ name: x })) } } : {}),
  };
});

async function withFeishuMocks(mockRequest, fn) {
  const request = feishu.request;
  const findBy = feishu.findBy;
  try {
    // Synthetic only: no external Feishu token, network call, customer record,
    // schedule or checkpoint is accessed by this regression test.
    feishu.findBy = async () => [];
    feishu.request = mockRequest;
    return await fn();
  } finally {
    feishu.request = request;
    feishu.findBy = findBy;
  }
}

test("direct Case create loads every schema page before POST and adapts select values", async () => {
  const seen = [];
  let posts = 0;
  await withFeishuMocks(async (_token, path, method, payload) => {
    seen.push(path);
    if (path.endsWith("/fields?page_size=100")) {
      return { items: fields.slice(0, 7), has_more: true, page_token: "next-page" };
    }
    if (path.endsWith("/fields?page_size=100&page_token=next-page")) {
      return { items: fields.slice(7), has_more: false };
    }
    if (method === "POST" && path.endsWith("/records")) {
      posts++;
      assert.deepEqual(payload.fields["CRM等级（Case核验）"], ["待核验"]);
      assert.equal(payload.fields["任务状态"], "待处理");
      assert.equal(payload.fields["问题类别"], "其他");
      return {};
    }
    throw Error("Unexpected request in direct schema test");
  }, async () => {
    assert.equal(await writer.upsertCase("fake-token", writer.TABLE, input), "created");
  });
  assert.equal(seen.filter(x => x.includes("/fields?")).length, 2);
  assert.equal(posts, 1);
});

test("direct Case write fails closed on missing schema pagination flag", async () => {
  let posts = 0;
  await withFeishuMocks(async (_token, path, method) => {
    if (path.includes("/fields?")) return { items: fields.slice(0, 7) };
    if (method === "POST") posts++;
    throw Error("Unexpected request");
  }, async () => {
    await assert.rejects(
      writer.upsertCase("fake-token", writer.TABLE, input),
      /field schema pagination flag invalid/
    );
  });
  assert.equal(posts, 0);
});

test("direct Case write rejects repeated schema cursors without POST", async () => {
  let posts = 0;
  await withFeishuMocks(async (_token, path, method) => {
    if (path.includes("/fields?")) {
      return { items: fields.slice(0, 7), has_more: true, page_token: "loop" };
    }
    if (method === "POST") posts++;
    throw Error("Unexpected request");
  }, async () => {
    await assert.rejects(
      writer.upsertCase("fake-token", writer.TABLE, input),
      /field schema pagination invalid/
    );
  });
  assert.equal(posts, 0);
});
