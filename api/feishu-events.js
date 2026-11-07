// Feishu bot webhook for Vercel (single chat first, group @ second).
// POST https://kailash-feishu-report-gateway.vercel.app/api/feishu-events
// Feishu console: Events & Callback -> switch from Long Connection to
// Request URL, paste the URL above, verify, publish.
// Env vars needed in Vercel (Production):
//   FEISHU_APP_ID, FEISHU_APP_SECRET (already set)
//   OPENAI_API_KEY (not set yet - without it the bot replies with a
//     "key not configured" message instead of staying silent)
//   OPENAI_MODEL (optional, default gpt-4o-mini)
//   FEISHU_VERIFICATION_TOKEN (optional, from Feishu console)
//   FEISHU_ENCRYPT_KEY (optional, only if encryption is on in Feishu)
const crypto = require("crypto");
const API = "https://open.feishu.cn/open-apis";
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

// In-memory dedupe for Feishu retries (per serverless instance).
const seen = new Set();
function alreadySeen(id) {
  if (!id) return false;
  if (seen.has(id)) return true;
  seen.add(id);
  if (seen.size > 200) {
    const first = seen.values().next().value;
    seen.delete(first);
  }
  return false;
}

function parseBody(req) {
  const b = req.body;
  if (!b) return {};
  if (typeof b === "string") {
    try { return JSON.parse(b); } catch { return {}; }
  }
  return b;
}

function decryptEncrypt(encrypt, encryptKey) {
  // Feishu: key = sha256(encryptKey), first 16 bytes of decoded
  // encrypt string are the IV, the rest is AES-256-CBC ciphertext.
  const key = crypto.createHash("sha256").update(encryptKey).digest();
  const buf = Buffer.from(encrypt, "base64");
  const iv = buf.subarray(0, 16);
  const data = buf.subarray(16);
  const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
  const out = Buffer.concat([decipher.update(data), decipher.final()]);
  return JSON.parse(out.toString("utf8"));
}

async function getTenantToken() {
  const r = await fetch(API + "/auth/v3/tenant_access_token/internal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      app_id: process.env.FEISHU_APP_ID,
      app_secret: process.env.FEISHU_APP_SECRET,
    }),
  });
  const d = await r.json();
  if (!r.ok || d.code !== 0 || !d.tenant_access_token) {
    throw new Error("Feishu auth failed: " + (d.msg || r.status));
  }
  return d.tenant_access_token;
}

async function sendFeishuMessage(token, chatId, text) {
  const r = await fetch(API + "/im/v1/messages?receive_id_type=chat_id", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      receive_id: chatId,
      msg_type: "text",
      content: JSON.stringify({ text: text.slice(0, 4000) }),
    }),
  });
  const d = await r.json();
  if (!r.ok || d.code !== 0) {
    throw new Error("Feishu send failed: " + (d.msg || r.status));
  }
  return d;
}

async function askChatGPT(userText) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);
  try {
    const r = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.7,
        max_tokens: 1000,
        messages: [
          {
            role: "system",
            content:
              "你是老道助手测试，Kailash Energy 店铺的运营助手。回答要简洁、直接，先给结论再给依据。用中文回答，除非用户用英文提问。",
          },
          { role: "user", content: userText },
        ],
      }),
      signal: ctrl.signal,
    });
    const d = await r.json();
    if (!r.ok) throw new Error("OpenAI " + r.status + ": " + (d.error?.message || "request failed"));
    return (d.choices?.[0]?.message?.content || "").trim() || "我收到你的消息了，但这次没有生成出回复，请再说一次。";
  } finally {
    clearTimeout(timer);
  }
}

module.exports = async (req, res) => {
  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      service: "feishu-events",
      configured: {
        FEISHU_APP_ID: !!process.env.FEISHU_APP_ID,
        FEISHU_APP_SECRET: !!process.env.FEISHU_APP_SECRET,
        OPENAI_API_KEY: !!process.env.OPENAI_API_KEY,
        OPENAI_MODEL: process.env.OPENAI_MODEL || "gpt-4o-mini",
      },
    });
  }
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "POST only" });
  }

  let body = parseBody(req);

  // 1) Feishu URL verification (Request URL setup step).
  if (body.type === "url_verification") {
    return res.status(200).json({ challenge: body.challenge });
  }

  // 2) Encrypted payload, if encryption is on in the Feishu console.
  if (body.encrypt) {
    if (!process.env.FEISHU_ENCRYPT_KEY) {
      console.error("feishu-events: encrypted event but FEISHU_ENCRYPT_KEY is not set");
      return res.status(200).json({ ok: false, error: "FEISHU_ENCRYPT_KEY not configured" });
    }
    try {
      body = decryptEncrypt(body.encrypt, process.env.FEISHU_ENCRYPT_KEY);
    } catch (e) {
      console.error("feishu-events: decrypt failed", e.message);
      return res.status(200).json({ ok: false, error: "decrypt failed" });
    }
  }

  const header = body.header || {};
  const event = body.event || {};

  // Optional token check, only when the env var is set.
  const expectedToken = process.env.FEISHU_VERIFICATION_TOKEN;
  if (expectedToken && header.token && header.token !== expectedToken) {
    return res.status(403).json({ ok: false, error: "bad verification token" });
  }

  // Only handle incoming messages.
  if (header.event_type !== "im.message.receive_v1") {
    return res.status(200).json({ ok: true, skipped: header.event_type || "unknown" });
  }
  if (header.event_id && alreadySeen(header.event_id)) {
    return res.status(200).json({ ok: true, skipped: "duplicate" });
  }

  const sender = event.sender || {};
  // Ignore messages sent by a bot / app itself, avoid reply loops.
  if (sender.sender_type === "app") {
    return res.status(200).json({ ok: true, skipped: "from_app" });
  }

  const message = event.message || {};
  const chatId = message.chat_id;
  if (!chatId) return res.status(200).json({ ok: true, skipped: "no_chat_id" });
  if (message.message_type !== "text") {
    try {
      const token = await getTenantToken();
      await sendFeishuMessage(token, chatId, "目前我只支持文字消息，请发文字给我。");
    } catch (e) {
      console.error("feishu-events: non-text reply failed", e.message);
    }
    return res.status(200).json({ ok: true, replied: "non_text" });
  }

  // Group chats: only reply when @-mentioned. Single chat always replies.
  const chatType = message.chat_type || "p2p";
  const mentions = message.mentions || [];
  if (chatType !== "p2p" && mentions.length === 0) {
    return res.status(200).json({ ok: true, skipped: "group_not_mentioned" });
  }

  let text = "";
  try {
    text = JSON.parse(message.content || "{}").text || "";
  } catch {
    text = "";
  }
  // Strip @_user_1 style mention placeholders before sending to ChatGPT.
  text = text.replace(/@_user_\d+/g, "").trim();
  if (!text) return res.status(200).json({ ok: true, skipped: "empty_text" });

  console.log("feishu-events: chat_type=" + chatType + " chat_id=" + chatId + " text=" + text.slice(0, 100));

  try {
    let reply = await askChatGPT(text);
    if (!reply) {
      reply =
        "我已收到你的消息：“" + text.slice(0, 100) + "”。但 ChatGPT 还没配好，Vercel 里缺少 OPENAI_API_KEY，配好后我就能正常回答了。";
    }
    const token = await getTenantToken();
    await sendFeishuMessage(token, chatId, reply);
    return res.status(200).json({ ok: true, replied: true });
  } catch (e) {
    console.error("feishu-events: reply failed", e.message);
    try {
      const token = await getTenantToken();
      await sendFeishuMessage(token, chatId, "抱歉，这次处理出错了，请稍后再试一次。（" + e.message.slice(0, 100) + "）");
    } catch {}
    return res.status(200).json({ ok: true, replied: "error_notice" });
  }
};
