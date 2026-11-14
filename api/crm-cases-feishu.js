"use strict";
const cases = require("../lib/crm-cases");
const feishu = require("../lib/crm-feishu");
const writeback = require("../lib/crm-case-feishu-writeback");

const STATE = "crm-cases/v1/feishu-writeback-state.json";
const BATCH_LIMIT = 40;
// Authenticated UAT may expose a fixed diagnostic code and a known field label,
// never source Case text, customer values, Feishu response bodies or tokens.
const SAFE_PREFLIGHT_FIELDS = new Set([
  "CRM等级（Case核验）", "问题类别", "任务优先级", "沟通渠道", "沟通方向", "任务状态"
]);
function safePreflightDiagnostic(error) {
  const message = String(error?.message || error);
  let code = "schema_mismatch";
  if (/Duplicate Case ID/.test(message)) code = "duplicate_case_id";
  else if (/Invalid Case ID/.test(message)) code = "invalid_case_id";
  else if (/select option not configured/.test(message)) code = "option_not_configured";
  else if (/select options unavailable/.test(message)) code = "select_options_missing";
  else if (/schema missing:/.test(message)) code = "field_missing";
  else if (/duplicate field name/.test(message)) code = "duplicate_schema_field";
  else if (/Invalid (?:single|multi)-select value/.test(message)) code = "invalid_select_value";
  else if (/human-owned field/.test(message)) code = "human_field_guard";
  const match = message.match(/(?:for:|missing:|mismatch:) (.+)$/);
  const candidate = match ? match[1].trim() : null;
  return { code, field: SAFE_PREFLIGHT_FIELDS.has(candidate) ? candidate : null };
}
module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") return res.status(405).json({ ok: false });
  if (!cases.authorized(req)) return res.status(401).json({ ok: false });
  try {
    const token = await feishu.tenantToken();
    // One fresh, validated field schema per request, shared across up to 40 Case writes.
    const { tableId, schema } = await writeback.ensureTable(token, { includeSchema: true });
    const events = await cases.allEvents(500);
    const grouped = cases.groupCases(events);
    const state = await cases.read(STATE) || { offset: 0 };
    const start = Number(state.offset) >= grouped.length ? 0 : Number(state.offset) || 0;
    const batch = grouped.slice(start, start + BATCH_LIMIT);
    // Authenticated, read-only UAT mode: checks the real approved Feishu
    // field schema/options and the next Case batch; never writes or advances
    // the checkpoint. No source events or customer PII in the response.
    const dryRun = req.query?.dryRun === "1";
    let checked;
    try {
      checked = writeback.preflightCaseBatch(batch, schema);
    } catch (err) {
      const diagnostic = safePreflightDiagnostic(err);
      // The scheduled cron emits only a fixed error code. The authorized
      // dryRun exposes only known schema field labels for isolated diagnosis.
      console.error("[crm-cases-feishu] schema preflight blocked", diagnostic.code);
      return res.status(409).json({
        ok: false, dryRun, blockedReason: "case_schema_preflight",
        ...(dryRun ? { diagnostic } : {}),
        totalCases: grouped.length, processed: 0,
        checkpointAdvanced: false,
      });
    }
    if (dryRun) return res.status(200).json({
      ok: true, dryRun: true, tableId, checked,
      totalCases: grouped.length, processed: 0,
      checkpointAdvanced: false,
    });
    const result = { created: 0, updated: 0, failed: 0 };
    let attempted = 0;
    let blockedReason = null;
    // Keep the entire batch checkpoint on any failure. Do not fan out a
    // deterministic Feishu schema error to all 40 Cases in the same run.
    for (const item of batch) {
      attempted++;
      try {
        result[await writeback.upsertCase(token, tableId, item, schema)]++;
      } catch (err) {
        result.failed++;
        const message = String(err.message || err);
        const schemaFailure = /MultiSelectFieldConvFail|SingleSelectFieldConvFail|select option not configured|Case field type mismatch|Feishu field schema/.test(message);
        console.error("[crm-cases-feishu] upsert failed", item.caseId,
          schemaFailure ? "schema_conversion_blocked" : message.slice(0, 110));
        if (schemaFailure) {
          blockedReason = "case_schema_conversion";
          break;
        }
      }
    }
    if (!result.failed) await cases.save(STATE, {
      offset: start + batch.length >= grouped.length ? 0 : start + batch.length,
      lastRunAt: new Date().toISOString(), tableId,
      scannedEvents: events.length, totalCases: grouped.length,
      lastBatchProcessed: batch.length,
      lastBatchCreated: result.created,
      lastBatchUpdated: result.updated,
      lastBatchFailed: result.failed,
    });
    return res.status(result.failed ? 502 : 200).json({
      ok: !result.failed, tableId, tableUrl: `https://ycnic6l8vkfx.feishu.cn/base/Y7VvbgreAasoLtsYdhrcmmDUn5d?table=${tableId}`,
      totalCases: grouped.length, processed: attempted, batchSize: batch.length,
      blockedReason, ...result,
    });
  } catch (err) {
    console.error("[crm-cases-feishu] failed", String(err.message || err).slice(0, 140));
    return res.status(502).json({ok:false,error:"feishu_writeback_unavailable",retryable:true});
  }
};
