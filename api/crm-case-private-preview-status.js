"use strict";
// Public status contains only aggregate delivery metadata, never customer details.
const { get } = require("@vercel/blob");
module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") return res.status(405).json({ ok:false });
  try {
    const response = await get("crm-cases/v1/private-report-preview-20261108.json", { access:"private", useCache:false });
    if (!response || response.statusCode !== 200) return res.status(200).json({ ok:true, sent:false });
    const chunks = [];
    for await (const chunk of response.stream) chunks.push(chunk);
    const row = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return res.status(200).json({ ok:true, sent:true, at:row.at, caseCount:row.count, private:true });
  } catch (error) {
    return res.status(503).json({ ok:false, error:"status_unavailable" });
  }
};
