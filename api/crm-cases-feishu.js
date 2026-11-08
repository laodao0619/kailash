"use strict";
const cases = require("../lib/crm-cases");
const feishu = require("../lib/crm-feishu");
const writeback = require("../lib/crm-case-feishu-writeback");

const STATE = "crm-cases/v1/feishu-writeback-state.json";
const BATCH_LIMIT = 40;
module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") return res.status(405).json({ ok: false });
  if (!cases.authorized(req)) return res.status(401).json({ ok: false });
  try {
    const token = await feishu.tenantToken();
    const tableId = await writeback.ensureTable(token);
    const events = await cases.allEvents(500);
    const grouped = cases.groupCases(events);
    const state = await cases.read(STATE) || { offset: 0 };
    const start = Number(state.offset) >= grouped.length ? 0 : Number(state.offset) || 0;
    const batch = grouped.slice(start, start + BATCH_LIMIT);
    const result = { created: 0, updated: 0, failed: 0 };
    // A failed record must be retried; no checkpoint advance on partial failure.
    for (const item of batch) {
      try {
        result[await writeback.upsertCase(token, tableId, item)]++;
      } catch (err) {
        result.failed++;
        console.error("[crm-cases-feishu] upsert failed", item.caseId, String(err.message || err).slice(0, 110));
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
      totalCases: grouped.length, processed: batch.length, ...result,
    });
  } catch (err) {
    console.error("[crm-cases-feishu] failed", String(err.message || err).slice(0, 140));
    return res.status(502).json({ok:false,error:"feishu_writeback_unavailable",retryable:true});
  }
};
