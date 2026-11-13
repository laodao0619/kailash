"use strict";
// CRON_SECRET-protected, read-only Feishu Case schema preflight.
// Does not enumerate Case events, change tables, POST/PUT records, or touch cursors.
const cases = require("../lib/crm-cases");
const feishu = require("../lib/crm-feishu");
const writeback = require("../lib/crm-case-feishu-writeback");
const { preflightCaseSchema } = require("../lib/crm-case-schema-preflight");

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") return res.status(405).json({ ok: false });
  if (!cases.authorized(req)) return res.status(401).json({ ok: false });
  try {
    const token = await feishu.tenantToken();
    const { schema } = await writeback.ensureTable(token, { includeSchema: true });
    return res.status(200).json({ ok: true, mode: "read_only", ...preflightCaseSchema(schema) });
  } catch (err) {
    // No token, personal data, field values, raw Feishu response or record IDs
    // in the API response. The protected endpoint reports only a blocked state.
    console.error("[case-schema-preflight] blocked", String(err.message || err).slice(0, 120));
    return res.status(503).json({
      ok: false, ready: false, mode: "read_only", code: "CASE_SCHEMA_PREFLIGHT_BLOCKED",
    });
  }
};
