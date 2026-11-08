module.exports = async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  return res.status(410).json({
    ok: false,
    error: "CRM homepage was created successfully. Bootstrap endpoint permanently disabled.",
    home: "https://ycnic6l8vkfx.feishu.cn/wiki/ISzIwGiJQi20Q4kUioGcojmwnWf"
  });
};
