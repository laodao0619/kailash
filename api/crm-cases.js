"use strict";
const cases = require("../lib/crm-cases");
module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "private, no-store");
  if (req.method !== "GET") return res.status(405).json({ ok: false });
  if (!cases.authorized(req)) return res.status(401).json({ ok: false });
  try {
    const max = Math.min(250, Math.max(1, Number(req.query?.scan || 150)));
    const limit = Math.min(50, Math.max(1, Number(req.query?.limit || 20)));
    const events = await cases.allEvents(max);
    const grouped = cases.groupCases(events);
    return res.status(200).json({
      ok: true, scannedEvents: events.length, caseCountWithinScan: grouped.length,
      caveat: "待核实候选，不代表未回复总数；CRM 等级、跨邮箱身份和处置结果待核验",
      cases: grouped.slice(0, limit),
    });
  } catch (err) {
    console.error("[crm-cases] failed", String(err.message || err).slice(0, 100));
    return res.status(502).json({ ok: false, error: "case_store_unavailable" });
  }
};
