"use strict";
// Pure, synthetic-data-only preflight for the approved Feishu Case table.
// No Shopify or Gmail customer data is read and this helper never writes.
const { adaptFields } = require("./crm-case-field-adapter");
const { recordFields } = require("./crm-case-feishu-writeback");

const REQUIRED_TYPES = Object.freeze({
  "问题类别": 3, "任务优先级": 3, "沟通渠道": 3,
  "沟通方向": 3, "任务状态": 3, "CRM等级（Case核验）": 4,
});
const CATEGORIES = Object.freeze(["物流", "产品", "退款", "赠品", "修改", "其他"]);
const PRIORITIES = Object.freeze(["P0", "P1", "P2"]);
const GRADES = Object.freeze(["S+", "S", "A", "B", "沉睡", "从未购买", "待核验"]);

function preflightCaseSchema(schema) {
  if (!Array.isArray(schema) || !schema.length) throw Error("Case preflight: field schema unavailable");
  const names = new Map();
  for (const f of schema) {
    if (!f || typeof f.field_name !== "string" || names.has(f.field_name)) {
      throw Error("Case preflight: duplicate or invalid field names");
    }
    names.set(f.field_name, Number(f.type));
  }
  for (const [field, expectedType] of Object.entries(REQUIRED_TYPES)) {
    if (names.get(field) !== expectedType) {
      throw Error("Case preflight: field type mismatch: " + field);
    }
  }
  let checked = 0;
  function verify(c) {
    const synthetic = {
      caseId: "CASE-000000000000",
      customerEmail: "synthetic@example.invalid",
      messageCount: 1,
      receivedAt: "2026-11-12T00:00:00Z",
      originalUrl: "https://mail.google.com/mail/u/0/#all/synthetic",
      ...c,
    };
    const fields = recordFields(synthetic, 0);
    // Validate both the creation-only human workflow default and updates.
    adaptFields(fields, schema);
    adaptFields({ ...fields, "任务状态": "待处理" }, schema);
    checked++;
  }
  for (const category of CATEGORIES) verify({ category, priority: "P2" });
  for (const priority of PRIORITIES) verify({ category: "物流", priority });
  for (const crmGrade of GRADES) verify({
    category: "物流", priority: "P2", crmVerified: true, crmGrade,
  });
  return { ready: true, syntheticCasesChecked: checked, fieldCount: schema.length };
}

module.exports = { preflightCaseSchema };
