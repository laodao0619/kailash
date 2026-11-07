const API = "https://open.feishu.cn/open-apis";
const APP_TOKEN = "Y7VvbgreAasoLtsYdhrcmmDUn5d";
const TABLES = [
  {
    id: "tblbk7Ju6fcM1BXF",
    expectedName: "数据表",
    name: "客户档案",
    primaryField: "客户唯一编号",
    fields: [
      ["客户姓名", 1], ["邮箱", 1], ["国家地区", 1], ["Shopify客户ID", 1],
      ["CRM等级", 3, ["S+", "S", "A", "B", "沉睡", "从未购买"]],
      ["近180天净消费", 2], ["最近下单日期", 5], ["近180天有效订单数", 2],
      ["历史累计消费", 2], ["历史订单数", 2], ["最近互动日期", 5],
      ["负责人", 1], ["客户状态", 3, ["活跃", "待维护", "风险", "沉睡", "已归档"]],
      ["WhatsApp", 1], ["客户备注", 1]
    ]
  },
  {
    id: "tblNi7C5q5FYlG06",
    expectedName: "数据表 2",
    name: "客户沟通与跟进",
    primaryField: "沟通记录编号",
    fields: [
      ["客户唯一编号", 1], ["客户姓名", 1], ["客户邮箱", 1], ["记录时间", 5],
      ["沟通渠道", 3, ["Gmail", "WhatsApp", "Instagram", "网站客服", "其他"]],
      ["沟通方向", 3, ["客户发起", "品牌发起"]],
      ["邮件主题", 1], ["沟通摘要", 1], ["客户意图", 1], ["客户情绪", 3, ["积极", "中性", "不满", "紧急"]],
      ["关联订单号", 1], ["处理结果", 1], ["下一步行动", 1], ["负责人", 1],
      ["截止日期", 5], ["任务状态", 3, ["待处理", "处理中", "等待客户", "已完成", "已取消"]],
      ["Gmail线程ID", 1], ["原邮件链接", 15]
    ]
  }
];
async function call(token, path, method = "GET", body) {
  const response = await fetch(API + path, {
    method,
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.code !== 0) {
    throw new Error((data.msg || response.statusText) + " [" + path + "]");
  }
  return data.data || data;
}
module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "POST only" });
  const supplied = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const expected = process.env.REPORT_GATEWAY_TOKEN || "";
  if (!expected || supplied !== expected) return res.status(401).json({ ok: false, error: "Unauthorized" });
  try {
    const auth = await fetch(API + "/auth/v3/tenant_access_token/internal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app_id: process.env.FEISHU_APP_ID, app_secret: process.env.FEISHU_APP_SECRET })
    });
    const authData = await auth.json();
    if (!auth.ok || authData.code !== 0 || !authData.tenant_access_token) {
      throw new Error("Feishu authentication failed: " + (authData.msg || auth.status));
    }
    const token = authData.tenant_access_token;
    const results = [];
    for (const spec of TABLES) {
      const basePath = "/bitable/v1/apps/" + APP_TOKEN + "/tables/" + spec.id;
      const tableData = await call(token, basePath);
      const table = tableData.table || tableData;
      if (table.name !== spec.name) {
        if (table.name !== spec.expectedName) {
          throw new Error("Unexpected table name " + table.name + " for " + spec.id + "; refusing to overwrite");
        }
        await call(token, basePath, "PATCH", { name: spec.name });
      }
      const existingData = await call(token, basePath + "/fields?page_size=100");
      const existing = existingData.items || existingData.fields || [];
      const primary = existing.find(field => field.is_primary) || existing[0];
      if (primary && primary.field_name !== spec.primaryField) {
        await call(token, basePath + "/fields/" + primary.field_id, "PUT", { field_name: spec.primaryField, type: 1 });
      }
      const names = new Set(existing.map(field => field.field_name));
      if (primary) names.add(spec.primaryField);
      const added = [];
      for (const [fieldName, type, options] of spec.fields) {
        if (names.has(fieldName)) continue;
        const field = { field_name: fieldName, type };
        if (type === 3 && options) field.property = { options: options.map(name => ({ name })) };
        await call(token, basePath + "/fields", "POST", field);
        names.add(fieldName);
        added.push(fieldName);
      }
      results.push({ table_id: spec.id, name: spec.name, primary_field: spec.primaryField, added_fields: added, existing_field_count: existing.length });
    }
    return res.status(200).json({
      ok: true,
      operation: "configure_existing_crm_tables",
      records_deleted: false,
      tables_created: false,
      product_asset_base_modified: false,
      results
    });
  } catch (error) {
    return res.status(502).json({ ok: false, error: error.message });
  }
};
