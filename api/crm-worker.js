const crypto = require("crypto");
const { put, get } = require("@vercel/blob");
const configure = require("./configure-crm-tables");
const configureViews = require("./configure-crm-views");
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
    const done = id => state.tasks.find(t=>t.id===id)?.status === "done";
    const invoke = async (handler) => {
      const result = {code:200,payload:null,status(code){this.code=code;return this;},json(data){this.payload=data;return data;}};
      await handler({method:"POST",headers:{authorization:"Bearer "+process.env.REPORT_GATEWAY_TOKEN}},result);
      if(result.code!==200||!result.payload?.ok)throw new Error(result.payload?.error||"Handler returned "+result.code);
      return result.payload;
    };
    let fields=null,views=null;
    if(!done("T02")||!done("T03")){
      fields=await invoke(configure);
      update(state,"T01","done","Protected cron worker and private Blob ledger operational");
      update(state,"T02","done","Existing customer profile schema configured");
      update(state,"T03","done","Existing follow-up schema configured");
      state.log.push({at:new Date().toISOString(),event:"CRM base fields configured",tables:fields.results?.map(x=>x.table_id)||[]});
      await saveLedger(state);
    }
    if(state.tasks.find(t=>t.id==="T04")?.status==="queued"||
       state.tasks.find(t=>t.id==="T04")?.status==="retry"){
      try{
        views=await invoke(configureViews);
        update(state,"T04","in_progress","Four base views created; filters and grouping pending");
        state.log.push({at:new Date().toISOString(),event:"CRM view scaffolding created"});
      }catch(viewError){
        update(state,"T04","retry",String(viewError.message).slice(0,500));
        state.log.push({at:new Date().toISOString(),event:"CRM view setup retry required",error:String(viewError.message).slice(0,500)});
      }
      await saveLedger(state);
    }
    return res.status(200).json({ok:true,status:"processed",fieldsConfigured:done("T02")&&done("T03"),
      viewStatus:state.tasks.find(t=>t.id==="T04")?.status,fields:fields?.results||null,views:views?.views||null});
  } catch (err) {
    if (state) {
      update(state, "T02", "retry", String(err.message).slice(0,500));
      state.log.push({ at: new Date().toISOString(), event: "CRM field setup failed; retry next run", error: String(err.message).slice(0,500) });
      try { await saveLedger(state); } catch (_) {}
    }
    return res.status(502).json({ ok: false, error: String(err.message).slice(0,500) });
  }
};
