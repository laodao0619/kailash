"use strict";
const gmail = require("../lib/crm-gmail");
const cases = require("../lib/crm-cases");
const feishu = require("../lib/crm-feishu");
const enrichment = require("../lib/crm-case-enrichment");

// Only expose coarse error categories in logs/status: never Gmail IDs or PII.
function failureType(err) {
  const message = String(err?.message || err);
  if (/^Gmail request failed: 403$/.test(message)) {
    if (err?.gmailReason === "insufficientPermissions") return "gmail_403_scope";
    if (["rateLimitExceeded","userRateLimitExceeded"].includes(err?.gmailReason)) return "gmail_rate_limit";
    return "gmail_403";
  }
  if (/^Gmail request failed: 404$/.test(message)) return "gmail_404";
  if (/^Gmail request failed: 429$/.test(message)) return "gmail_rate_limit";
  return "other";
}

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
    const failureTypes = { gmail_403_scope: 0, gmail_403: 0, gmail_404: 0, gmail_rate_limit: 0, other: 0 };
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
        const kind = failureType(err);
        failureTypes[kind]++;
        // A Gmail permission/rate-limit failure blocks this whole page. Stop
        // immediately: continuing to fetch 49 more messages only amplifies
        // provider denials. The unchanged page cursor retries every item.
        if (kind === "gmail_403_scope" || kind === "gmail_403" || kind === "gmail_rate_limit") break;
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
      state.lastAttemptAt = state.lastRunAt;
      state.blocked = false;
      state.lastErrorCount = 0;
      state.lastErrorTypes = null;
      await cases.save(cases.STATE, state);
    }
    if (counts.errors) {
      const attemptedAt = new Date().toISOString();
      // Persist a private diagnostic without moving the cursor or changing
      // accumulated counts. Gmail-ID keyed events already saved are idempotent.
      if (!dryRun) await cases.save(cases.STATE, {
        ...state, blocked: true, lastAttemptAt: attemptedAt,
        lastErrorAt: attemptedAt, lastErrorCount: counts.errors,
        lastErrorTypes: failureTypes,
      });
      console.error("[crm-cases-sync] page blocked", JSON.stringify({
        failed: counts.errors, failureTypes, cursorAdvanced: false,
      }));
      return res.status(502).json({
        ok: false, retryable: true, reason: "case_page_has_failed_events",
        dryRun, counts, failureTypes, cursorAdvanced: false,
        cycleComplete: false,
      });
    }
    return res.status(200).json({ ok: true, dryRun, counts, cursorAdvanced: !dryRun, cycleComplete: !result.nextPageToken, note: "增量扫描；按 Gmail ID 幂等留档；未发送邮件或变更订单" });
  } catch (err) {
    console.error("[crm-cases-sync] failed", String(err.message || err).slice(0, 100));
    return res.status(502).json({ ok: false, error: "sync_unavailable", retryable: true });
  }
};
