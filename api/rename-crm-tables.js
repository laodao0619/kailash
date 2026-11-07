const API = "https://open.feishu.cn/open-apis";
const APP_TOKEN = "Y7VvbgreAasoLtsYdhrcmmDUn5d";
const TABLES = [
  { id: "tblbk7Ju6fcM1BXF", expected: "数据表", name: "客户档案" },
  { id: "tblNi7C5q5FYlG06", expected: "数据表 2", name: "客户沟通与跟进" }
];
module.exports = async (req, res) => {
  if (req.method !== "GET" || req.query.once !== "crm-rename-20261108-k8R4m2") {
    return res.status(404).json({ ok: false, error: "Not found" });
  }
  try {
    const auth = await fetch(API + "/auth/v3/tenant_access_token/internal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        app_id: process.env.FEISHU_APP_ID,
        app_secret: process.env.FEISHU_APP_SECRET
      })
    });
    const authData = await auth.json();
    if (!auth.ok || authData.code !== 0 || !authData.tenant_access_token) {
      throw new Error("Feishu authentication failed: " + (authData.msg || auth.status));
    }
    const headers = {
      Authorization: "Bearer " + authData.tenant_access_token,
      "Content-Type": "application/json"
    };
    const results = [];
    for (const spec of TABLES) {
      const read = await fetch(API + "/bitable/v1/apps/" + APP_TOKEN + "/tables/" + spec.id, { headers });
      const readData = await read.json();
      if (!read.ok || readData.code !== 0) {
        throw new Error("Cannot verify table " + spec.id + ": " + (readData.msg || read.status));
      }
      const table = readData.data?.table || readData.data || {};
      const currentName = table.name;
      if (currentName === spec.name) {
        results.push({ table_id: spec.id, previous_name: spec.expected, name: spec.name, status: "already_named" });
        continue;
      }
      if (currentName !== spec.expected) {
        throw new Error("Unexpected table name for " + spec.id + ": " + currentName + ". Refusing to overwrite.");
      }
      const update = await fetch(API + "/bitable/v1/apps/" + APP_TOKEN + "/tables/" + spec.id, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ name: spec.name })
      });
      const updateData = await update.json();
      if (!update.ok || updateData.code !== 0) {
        throw new Error("Rename failed for " + spec.id + ": " + (updateData.msg || update.status));
      }
      results.push({ table_id: spec.id, previous_name: currentName, name: spec.name, status: "renamed" });
    }
    return res.status(200).json({
      ok: true,
      scope: "Only the two approved CRM tables in the existing Bitable base",
      no_records_deleted: true,
      product_asset_base_touched: false,
      results
    });
  } catch (error) {
    return res.status(502).json({ ok: false, error: error.message });
  }
};
