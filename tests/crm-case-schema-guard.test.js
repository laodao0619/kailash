"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const feishu = require("../lib/crm-feishu");
const { ensureTable, TABLE, NAME, EXTRA } = require("../lib/crm-case-feishu-writeback");

test("Case setup refuses paginated table listing without writing", async () => {
  const original = feishu.request;
  const calls = [];
  feishu.request = async (_token, path, method = "GET") => {
    calls.push({ path, method });
    return { items: [{ table_id: TABLE, name: NAME }], has_more: true };
  };
  try {
    await assert.rejects(ensureTable("test-token"), /table listing incomplete/);
    assert.equal(calls.length, 1);
    assert.equal(calls.some(c => c.method !== "GET"), false);
  } finally { feishu.request = original; }
});

test("Case setup refuses paginated field schema before creating fields", async () => {
  const original = feishu.request;
  const calls = [];
  feishu.request = async (_token, path, method = "GET") => {
    calls.push({ path, method });
    if (path.endsWith("/tables?page_size=100")) return { items: [{ table_id: TABLE, name: NAME }], has_more: false };
    return { items: [], has_more: true };
  };
  try {
    await assert.rejects(ensureTable("test-token"), /field schema incomplete/);
    assert.equal(calls.length, 2);
    assert.equal(calls.some(c => c.method !== "GET"), false);
  } finally { feishu.request = original; }
});

test("Case setup never creates a missing approved field", async () => {
  const original = feishu.request;
  const calls = [];
  feishu.request = async (_token, path, method = "GET") => {
    calls.push({ path, method });
    if (path.endsWith("/tables?page_size=100")) {
      return { items: [{ table_id: TABLE, name: NAME }], has_more: false };
    }
    return { items: EXTRA.slice(1).map(f => ({field_name:f.field_name,type:f.type})), has_more: false };
  };
  try {
    await assert.rejects(ensureTable("test-token"), /Required Case field missing: Case ID/);
    assert.equal(calls.length, 2);
    assert.equal(calls.some(c => c.method !== "GET"), false);
  } finally { feishu.request = original; }
});

test("Case setup blocks type drift without touching the table", async () => {
  const original = feishu.request;
  const calls = [];
  feishu.request = async (_token, path, method = "GET") => {
    calls.push({ path, method });
    if (path.endsWith("/tables?page_size=100")) {
      return { items: [{ table_id: TABLE, name: NAME }], has_more: false };
    }
    return { items: EXTRA.map(f => ({field_name:f.field_name,type:f.field_name === "邮件数量" ? 1 : f.type})), has_more: false };
  };
  try {
    await assert.rejects(ensureTable("test-token"), /Case field type mismatch: 邮件数量/);
    assert.equal(calls.length, 2);
    assert.equal(calls.some(c => c.method !== "GET"), false);
  } finally { feishu.request = original; }
});
