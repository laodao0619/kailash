"use strict";
const gmail = require("../lib/crm-gmail");
const cases = require("../lib/crm-cases");
const feishu = require("../lib/crm-feishu");
const enrichment = require("../lib/crm-case-enrichment");

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") return res.status(405).json({ ok: false });
  if (!cases.authorized(req)) return res.status(401).json({ ok: false });
  if (!process.env.BLOB_READ_WRITE_TOKEN && !process.env.BLOB_STORE_ID) return res.status(503).json({ ok: false, reason: "private_blob_missing" });
  try {
    const dryRun = req.query?.dry_run === "1";
    const state = (await cases.read(cases.STATE)) || { pageToken: null, scanned: 0, accepted: 0, excluded: 0 };
    const [oauth, feishuToken] = await Promise.all([gmail.token(), feishu.tenantToken()]);
    const result = await gmail.listMessages(oauth, {
      maxResults: 50, pageToken: state.pageToken || undefined,
      after: new Date(Date.now() - cases.DAYS * 86400000).toISOString(), query: "in:inbox",
    });
    const counts = { scanned: 0, accepted: 0, excluded: 0, errors: 0 };
    for (const row of result.messages || []) {
      try {
        const msg = await gmail.message(oauth, row.id);
        counts.scanned++;
        if (gmail.classifyMessage(msg) !== "candidate") { counts.excluded++; continue; }
        const e = await enrichment.enrich(cases.event(msg), msg, oauth, feishuToken);
        if (!dryRun) await cases.save(cases.PREFIX + encodeURIComponent(msg.id) + ".json", e);
        counts.accepted++;
      } catch (err) {
        counts.errors++;
        console.error("[crm-cases-sync] event failed", String(err.message || err).slice(0, 100));
      }
    }
    // Cursor never advances when an event failed: retries are idempotent by Gmail ID.
    if (!dryRun && !counts.errors) {
      state.pageToken = result.nextPageToken || null;
      state.scanned += counts.scanned;
      state.accepted += counts.accepted;
      state.excluded += counts.excluded;
      state.completedCycleAt = result.nextPageToken ? state.completedCycleAt : new Date().toISOString();
      state.lastRunAt = new Date().toISOString();
      await cases.save(cases.STATE, state);
    }
    return res.status(200).json({ ok: true, dryRun, counts, cursorAdvanced: !dryRun && !counts.errors, cycleComplete: !result.nextPageToken, note: "增量扫描；按 Gmail ID 幂等留档；未发送邮件或变更订单" });
  } catch (err) {
    console.error("[crm-cases-sync] failed", String(err.message || err).slice(0, 100));
    return res.status(502).json({ ok: false, error: "sync_unavailable", retryable: true });
  }
};
