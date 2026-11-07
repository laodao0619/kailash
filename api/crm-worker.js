const crypto = require("crypto");
const { put, get } = require("@vercel/blob");
const configure = require("./configure-crm-tables");
const PATH = "crm-execution/tasks.json";

function authorized(req) {
  const supplied = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const expected = process.env.CRON_SECRET || "";
  const a = Buffer.from(supplied), b = Buffer.from(expected);
  return !!expected && a.length === b.length && crypto.timingSafeEqual(a, b);
}
async function readLedger() {
  const response = await get(PATH, { access: "private" });
  if (!response || response.statusCode !== 200) return null;
  const chunks = [];
  for await (const chunk of response.stream) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
async function saveLedger(state) {
  state.updated_at = new Date().toISOString();
  state.log = (state.log || []).slice(-150);
  await put(PATH, JSON.stringify(state), {
    access: "private", addRandomSuffix: false, allowOverwrite: true,
    contentType: "application/json"
  });
}
function update(state, taskId, status, detail) {
  const task = state.tasks.find(t => t.id === taskId);
  if (task) {
    task.status = status;
    task.last_run_at = new Date().toISOString();
    if (detail) task.detail = detail;
  }
}
module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") return res.status(405).json({ ok: false });
  if (!authorized(req)) return res.status(401).json({ ok: false, error: "Unauthorized" });
  let state;
  try {
    state = await readLedger();
    if (!state) return res.status(503).json({ ok: false, error: "Task ledger not initialized" });
    const t02 = state.tasks.find(t => t.id === "T02");
    const t03 = state.tasks.find(t => t.id === "T03");
    if (t02?.status === "done" && t03?.status === "done") {
      return res.status(200).json({ ok: true, status: "already_completed", tasks: ["T02","T03"] });
    }
    const fake = {
      code: 200, payload: null,
      status(code) { this.code = code; return this; },
      json(payload) { this.payload = payload; return payload; }
    };
    await configure({
      method: "POST",
      headers: { authorization: "Bearer " + process.env.REPORT_GATEWAY_TOKEN }
    }, fake);
    if (fake.code !== 200 || !fake.payload?.ok) {
      throw new Error(fake.payload?.error || ("Schema setup failed: HTTP " + fake.code));
    }
    update(state, "T01", "done", "Blob ledger and protected cron worker verified");
    update(state, "T02", "done", "Customer profile schema configured");
    update(state, "T03", "done", "Customer follow-up schema configured");
    state.log.push({ at: new Date().toISOString(), event: "CRM field schema configured", result: fake.payload.results });
    await saveLedger(state);
    return res.status(200).json({ ok: true, status: "completed", results: fake.payload.results });
  } catch (err) {
    if (state) {
      update(state, "T02", "retry", String(err.message).slice(0,500));
      state.log.push({ at: new Date().toISOString(), event: "CRM field setup failed; retry next run", error: String(err.message).slice(0,500) });
      try { await saveLedger(state); } catch (_) {}
    }
    return res.status(502).json({ ok: false, error: String(err.message).slice(0,500) });
  }
};
