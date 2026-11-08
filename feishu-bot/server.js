// Feishu bot long-connection server v5 (Node.js, official SDK WebSocket mode).
// 在 v4 基础上增加：Shopify 订单数据查询（只读），4 个工具：按订单号/邮箱/状态查订单、
// 按日期汇总销售、列已付款未发货订单、查客户。直接用 fetch 调 Shopify Admin REST API
// （2026-10），不引新依赖；配置 SHOPIFY_STORE / SHOPIFY_ACCESS_TOKEN，未配时工具直接
// 返回中文提示，不调接口。金额和日期注明来源 Shopify、时间 EST。
// 在 v3 基础上增加：
// 1. 支持富文本消息：message_type 为 'post' 时，从 content JSON 里提取纯文字再按正常流程处理。
//    （之前只认 'text'，带格式的消息会被当成非文字挡掉。图片、文件、语音、视频、表情等
//    其他类型仍回“只支持文字消息”提示。）
// 2. 深度分析：用户要求全面归纳（全部读取、分析、归纳、总结）时，工具读完文档后多调一次 GPT
//    （ANALYSIS_MODEL，默认 gpt-4o，更强的模型）做合并分析，输出核心结论、关键数字、
//    P0/P1/P2 优先级事项、风险与矛盾点、建议行动，并把合并分析写入知识库
//    （source '综合分析'，type 'analysis'）。普通聊天和单篇摘要仍用 OPENAI_MODEL（gpt-4o-mini）。
// 3. 输出改成富文本：回复改用飞书 post 类型消息（Markdown 转 post，支持标题、加粗、
//    无序/有序列表、普通段落），转换失败或发送失败时回退到 text 消息。sendText 保留为回退通道。
//    post 消息同样截断到约 4000 字。
// v3 的全部功能保留：对话记忆 20 条、知识库 200 条、5 个工具、8 轮工具循环、去重、
// 忽略 app 发送者、单聊直回、群聊仅 @、剥除 @_user_N、无 Key 固定提示。
// Run: npm install && node server-v5.js (needs Node 18+)
// Env (copy.env.example to.env, never commit real values):
// FEISHU_APP_ID, FEISHU_APP_SECRET, OPENAI_API_KEY, OPENAI_MODEL (optional), ANALYSIS_MODEL (optional, default gpt-4o), SHOPIFY_STORE, SHOPIFY_ACCESS_TOKEN (read-only)
// 注意：本文件不读取.env，生产上由 systemd 的 EnvironmentFile 注入环境变量。
const lark = require('@larksuiteoapi/node-sdk');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createCrmReadonly } = require('./crm-readonly');

const APP_ID = process.env.FEISHU_APP_ID;
const APP_SECRET = process.env.FEISHU_APP_SECRET;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const ANALYSIS_MODEL = process.env.ANALYSIS_MODEL || 'gpt-4o'; // 深度分析用更强的模型，同一个 OPENAI_API_KEY
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

// ---- Shopify 配置（只读查询） ----
// SHOPIFY_STORE：形如 kailashenergy.myshopify.com，不含 https://
// SHOPIFY_ACCESS_TOKEN：店铺后台建的只读 Admin API 令牌。
// 两个变量缺任何一个时，Shopify 工具直接返回中文提示，不调接口。
const SHOPIFY_STORE = process.env.SHOPIFY_STORE || '';
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN || '';
const SHOPIFY_API_VERSION = '2026-10';
const SHOPIFY_NOT_CONFIGURED = 'Shopify 还没接好，缺少配置：请在服务器 .env 里配好 SHOPIFY_STORE 和 SHOPIFY_ACCESS_TOKEN（只读令牌）后再试。';

if (!APP_ID ||!APP_SECRET) {
console.error('[feishu-bot] FEISHU_APP_ID / FEISHU_APP_SECRET is missing, check.env');
process.exit(1);
}

const client = new lark.Client({
appId: APP_ID,
appSecret: APP_SECRET,
appType: lark.AppType.SelfBuild,
domain: lark.Domain.Feishu, // open.feishu.cn (China)
});
const crmReadonly = createCrmReadonly(client);

// ---- 常量 ----
const HISTORY_DIR = path.join(__dirname, 'history');
const KB_FILE = path.join(__dirname, 'knowledge.json');
const HISTORY_MAX = 20; // 最近 20 条消息（约 10 轮对话）
const KB_MAX = 200;

// ---- 系统提示词：12:04 版原文 + v2 工具说明 + 记忆/知识库说明 ----
const SYSTEM_PROMPT = '你是老道助手测试，Kailash Energy 店铺的运营助手，由 GPT-4o-mini 驱动，通过 API 接入。当被问到你是什么、数据从哪里来时，如实说：你由 GPT 驱动；广告和邮件的实时分析接口尚未接通，不要编造数字。Shopify 订单数据已接通，查订单、销售、客户时用 Shopify 工具；CRM客户档案通过独立的飞书只读工具查询，未授权或数据未计算时必须如实说明。不要说自己没有和 GPT 链接。回答要简洁、直接，先给结论再给依据。用中文回答，除非用户用英文提问。'
+ '你现在可以查公司飞书里的数据：用工具按关键词搜索云文档和多维表格、读取多维表格的记录、读取云文档正文。当用户问到公司文档、表格、运营数据时，先用工具去查，不要凭空回答；依据查到的内容回答，并注明数据来源和表格名字；如果工具返回查不到或没有权限，如实告诉用户原因，并请用户把表格链接发给你，或把文件分享给应用「老道_助手测试」。广告和邮件的实时分析接口尚未接通，不要编造。'
+ '你有对话记忆和知识库：你会记得同一会话里最近的对话内容，回答时结合上文；回答前会先在知识库里匹配相关内容，优先用知识库里的摘要回答并注明来源（文档或表格名）。当用户要求把若干文档逐一打开总结归纳时，你要主动先列出或搜索出文档清单，逐个打开、逐个摘要存入知识库，最后给一份合并总结；不要反复向用户要文档名或链接，只有实在找不到时才问一次。'
+ '回答要结构化：先给结论，再给依据；事项按优先级 P0/P1/P2 分，重点加粗，数字必须注明来源。被要求全面归纳（全部读取、分析、归纳、总结）时，先逐一读完文档再做合并分析，不要只给摘录式摘要。'
+ 'Shopify 已接通：问订单、销售、客户时先用 Shopify 工具查，依据查到的内容回答并注明来源是 Shopify、时间是 EST（店铺时间）；查不到如实说，不要编造数字；销售口径以 Shopify 为准。';
const CRM_PROMPT = 'CRM客户档案已提供独立的飞书Bitable只读工具。问CRM等级、RFM、生命周期、CRM客户跟进时使用CRM工具，不使用Shopify实时累计消费推断180天M/R/F。CRM等级或RFM为空时明确回答“尚未完成计算”；只有CRM等级字段明确为S+时才认定S+。复购必须说明“历史（历史订单数≥2）”或“近180天（近180天有效订单数≥2）”的周期。RFM八类：重要价值用户、重要保持用户、重要发展用户、一般发展用户、重要挽留用户、一般挽留用户、一般价值用户、一般保持用户。CRM客户资料只允许已授权员工在单聊中查询。';

// ---- 对话记忆：按 chat_id 存磁盘 JSON ----
// 文件名用 chat_id 的 SHA-256（前 32 位 hex）映射，绝不直接把 chat_id 拼进路径。
function histFile(chatId) {
const hash = crypto.createHash('sha256').update(String(chatId)).digest('hex').slice(0, 32);
return path.join(HISTORY_DIR, hash + '.json');
}

function loadHistory(chatId) {
try {
const arr = JSON.parse(fs.readFileSync(histFile(chatId), 'utf8'));
if (!Array.isArray(arr)) return [];
return arr.filter((m) => m && typeof m.role === 'string' && typeof m.content === 'string');
} catch { return [];}
}

function saveHistory(chatId, history) {
try {
fs.mkdirSync(HISTORY_DIR, { recursive: true});
fs.writeFileSync(histFile(chatId), JSON.stringify(history.slice(-HISTORY_MAX), null, 2), 'utf8');
} catch (e) {
console.error('[feishu-bot] save history failed', e.message);
}
}

// ---- 知识库：knowledge.json ----
// 每条 {source, type, summary, key_points, updated_at}，上限 200 条，超了淘汰最旧的。
function loadKB() {
try {
const arr = JSON.parse(fs.readFileSync(KB_FILE, 'utf8'));
return Array.isArray(arr)? arr: [];
} catch { return [];}
}

function saveKB(kb) {
try {
fs.writeFileSync(KB_FILE, JSON.stringify(kb.slice(-KB_MAX), null, 2), 'utf8');
} catch (e) {
console.error('[feishu-bot] save knowledge base failed', e.message);
}
}

// 写入或更新一条知识库记录（按 source 去重），供深度分析等调用。
function upsertKBEntry(entry) {
const kb = loadKB();
const now = new Date().toISOString();
const rec = {
source: entry.source,
type: entry.type || '',
summary: String(entry.summary || '').slice(0, 1000),
key_points: (entry.key_points || []).map(String).slice(0, 10),
updated_at: now,
};
const idx = kb.findIndex((x) => x.source === entry.source);
if (idx >= 0) kb[idx] = rec; else kb.push(rec);
saveKB(kb);
console.log('[feishu-bot] knowledge base updated:', entry.source);
}

// 关键词切分：按空白/标点切出长度 >= 2 的词；中文连续串再取 2 字滑窗，方便中文匹配。
function tokenize(text) {
const toks = new Set();
String(text || '').split(/[\s,，。；;：:、！!？?「」『』（）()\[\]《》'"“”]+/).forEach((t) => { if (t.length >= 2) toks.add(t);});
const cjk = String(text || '').match(/[\u4e00-\u9fa5]{2,}/g) || [];
cjk.forEach((run) => { for (let i = 0; i < run.length - 1; i++) toks.add(run.slice(i, i + 2));});
return [...toks];
}

// 按关键词在知识库里匹配相关条目，取最相关的 3 条。
function searchKB(userText, kb) {
const toks = tokenize(userText);
if (!toks.length ||!kb.length) return [];
const scored = kb.map((e) => {
const hay = [e.source, e.type, e.summary, (e.key_points || []).join(' ')].join(' ');
let score = 0;
for (const t of toks) {
if (t.length >= 2 && hay.includes(t)) score += t.length >= 4? 2: 1;
}
return { e, score};
}).filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
return scored.slice(0, 3).map((x) => x.e);
}

function formatKBHits(hits) {
return hits.map((e) => {
const pts = (e.key_points || []).join('；');
return '来源：' + e.source + '（类型：' + (e.type || '') + '，更新于 ' + (e.updated_at || '') + '）\n摘要：' + (e.summary || '') + (pts? '\n要点：' + pts: '');
}).join('\n---\n');
}

// 把一段读到的内容调一次 GPT 生成结构化摘要，写入或更新知识库（按 source 去重）。
async function summarizeTextToKB(source, type, content) {
if (!OPENAI_API_KEY) return;
const ctrl = new AbortController();
const timer = setTimeout(() => ctrl.abort(), 25000);
try {
const r = await fetch(OPENAI_URL, {
method: 'POST',
headers: { Authorization: 'Bearer ' + OPENAI_API_KEY, 'Content-Type': 'application/json'},
body: JSON.stringify({
model: OPENAI_MODEL, temperature: 0.3, max_tokens: 800,
messages: [
{ role: 'system', content: '你是知识库整理助手。把给你的文档或表格内容整理成结构化摘要，只输出 JSON：{"summary": "一到三句话的摘要，含关键数字和结论", "key_points": ["要点1", "要点2", "要点3"]}。不要输出 JSON 之外的文字。'},
{ role: 'user', content: '来源：' + source + '\n内容：\n' + String(content).slice(0, 6000)},
],
}),
signal: ctrl.signal,
});
const d = await r.json();
if (!r.ok) throw new Error('OpenAI ' + r.status);
const text = (d.choices?.[0]?.message?.content || '').trim();
let parsed = null;
try { parsed = JSON.parse(text);} catch {
const m = text.match(/\{[\s\S]*\}/);
if (m) { try { parsed = JSON.parse(m[0]);} catch { parsed = null;}}
}
const summary = (parsed && parsed.summary) || text.slice(0, 500);
const key_points = (parsed && Array.isArray(parsed.key_points))? parsed.key_points.map(String): [];
const kb = loadKB();
const now = new Date().toISOString();
const entry = { source, type, summary: String(summary).slice(0, 1000), key_points: key_points.slice(0, 10), updated_at: now};
const idx = kb.findIndex((x) => x.source === source);
if (idx >= 0) kb[idx] = entry; else kb.push(entry);
saveKB(kb);
console.log('[feishu-bot] knowledge base updated:', source);
} catch (e) {
console.error('[feishu-bot] summarize to KB failed', source, e.message);
} finally { clearTimeout(timer);}
}

// 本轮工具读到的内容，逐个摘要存入知识库（后台跑，不阻塞回复；每轮最多 3 条）。
async function updateKBFromReads(reads) {
if (!reads ||!reads.length) return;
const seenSrc = new Set();
const uniq = reads.filter((r) => {
if (!r ||!r.source || seenSrc.has(r.source)) return false;
seenSrc.add(r.source);
return true;
}).slice(0, 3);
for (const r of uniq) {
await summarizeTextToKB(r.source, r.type, r.content);
}
}

// ---- 深度分析 ----
// 用户是否要求全面归纳（全部读取、分析、归纳、总结）。
function wantsDeepAnalysis(text) {
const t = String(text || '');
return ['全部读取', '全部读', '全面归纳', '全面分析', '深度分析', '归纳总结', '总结归纳', '逐一', '所有文档', '全部文档', '全部分析', '分析归纳', '归纳分析'].some((k) => t.includes(k));
}

// 用更强的模型（ANALYSIS_MODEL，默认 gpt-4o）对本轮读到的资料做一次合并分析，
// 输出结构化 Markdown，并把结果写入知识库（source '综合分析'，type 'analysis'）。
async function runDeepAnalysis(userText, reads) {
if (!OPENAI_API_KEY ||!reads ||!reads.length) return null;
const material = reads.map((r) => '\n' + String(r.content || '').slice(0, 3000)).join('\n\n').slice(0, 12000);
const ctrl = new AbortController();
const timer = setTimeout(() => ctrl.abort(), 25000);
try {
const r = await fetch(OPENAI_URL, {
method: 'POST',
headers: { Authorization: 'Bearer ' + OPENAI_API_KEY, 'Content-Type': 'application/json'},
body: JSON.stringify({
model: ANALYSIS_MODEL, temperature: 0.3, max_tokens: 2000,
messages: [
{ role: 'system', content: '你是 Kailash Energy 的高级运营分析师。只依据下面提供的文档和表格内容做一次全面合并分析，不要编造数字。输出 Markdown，结构如下：\n## 核心结论\n（3-5 句）\n## 关键数字\n（每个数字注明来源文档或表格）\n## 优先级事项\n- P0：……\n- P1：……\n- P2：……\n## 风险与矛盾点\n（不同文档之间不一致或缺口）\n## 建议行动\n（按优先级列出下一步）'},
{ role: 'user', content: '用户要求：' + userText + '\n\n读取到的资料：\n' + material},
],
}),
signal: ctrl.signal,
});
const d = await r.json();
if (!r.ok) throw new Error('OpenAI ' + r.status);
const text = (d.choices?.[0]?.message?.content || '').trim();
if (!text) return null;
const key_points = text.split('\n').map((l) => l.trim()).filter((l) => /^[-•*]\s/.test(l) || /^P[012]/.test(l) || /^\d+[.、]\s/.test(l)).map((l) => l.replace(/^[-•*\d.、\s]+/, '').replace(/\*\*/g, '').slice(0, 120)).slice(0, 10);
upsertKBEntry({ source: '综合分析', type: 'analysis', summary: text.replace(/\*\*/g, ''), key_points});
return text;
} catch (e) {
console.error('[feishu-bot] deep analysis failed', e.message);
return null;
} finally { clearTimeout(timer);}
}

// ---- Shopify（只读查询，用 fetch 直接调 Admin REST API，不引新依赖） ----
function shopifyConfigured() {
  return Boolean(SHOPIFY_STORE && SHOPIFY_ACCESS_TOKEN);
}

// 店铺时区 EST（UTC-5）：取当前 EST 日期（YYYY-MM-DD）。
function estToday() {
  return new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 10);
}

// EST 日期 YYYY-MM-DD 当天 00:00 对应的 UTC ISO 时间（EST 午夜 = UTC 05:00）。
function estDateStartISO(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr || '');
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 5, 0, 0)).toISOString();
}

// 把 Shopify 返回的 ISO 时间格式化为 EST 时间 "YYYY-MM-DD HH:mm EST"。
function fmtEst(iso) {
  if (!iso) return '';
  const d = new Date(new Date(iso).getTime() - 5 * 3600 * 1000);
  return d.toISOString().slice(0, 16).replace('T', ' ') + ' EST';
}

// 账龄天数：从下单时间到现在（EST）的整天数。
function ageDays(iso) {
  if (!iso) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));
}

// 从 Shopify 的 Link 响应头里取下一页的 page_info，没有下一页返回 null。
function nextPageInfo(link) {
  if (!link) return null;
  const m = /<[^>]*[?&]page_info=([^&>]+)[^>]*>;\s*rel="next"/.exec(link);
  return m ? decodeURIComponent(m[1]) : null;
}

// 调 Shopify Admin REST API，返回 { data, link } 或 { error }；失败不抛错。
async function shopifyFetch(path, params) {
  if (!shopifyConfigured()) return { error: SHOPIFY_NOT_CONFIGURED };
  const qs = new URLSearchParams(params || {}).toString();
  const url = 'https://' + SHOPIFY_STORE + '/admin/api/' + SHOPIFY_API_VERSION + path + (qs ? '?' + qs : '');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);
  try {
    const r = await fetch(url, {
      method: 'GET',
      headers: { 'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN, 'Content-Type': 'application/json' },
      signal: ctrl.signal,
    });
    const text = await r.text();
    let data = null;
    try { data = JSON.parse(text); } catch { data = null; }
    if (!r.ok) {
      const errs = data && data.errors;
      const msg = errs ? (typeof errs === 'string' ? errs : JSON.stringify(errs)) : ('HTTP ' + r.status);
      return { error: 'Shopify 请求失败（' + r.status + '）：' + msg + '。请检查令牌是否为只读权限、店铺地址是否正确。' };
    }
    const link = r.headers && typeof r.headers.get === 'function' ? r.headers.get('link') : '';
    return { data, link: link || '' };
  } catch (e) {
    return { error: 'Shopify 请求出错：' + (e.message || '网络错误') + '。请稍后再试。' };
  } finally { clearTimeout(timer); }
}

// 订单客户名（优先 customer 的姓名，其次订单邮箱）。
function orderCustomerName(o) {
  const c = o.customer || {};
  const name = ((c.first_name || '') + ' ' + (c.last_name || '')).trim();
  return name || o.email || '未留姓名';
}

// 一条订单的简要说明（金额和时间注明来源 Shopify、EST）。
function fmtOrderBrief(o) {
  const items = (o.line_items || []).slice(0, 5).map((li) => (li.title || '') + ' x' + (li.quantity || 1)).join('、');
  const tracking = (o.fulfillments || []).flatMap((f) => (f.tracking_numbers || [])).filter(Boolean);
  const lines = [
    '订单号：' + (o.name || o.id),
    '下单时间：' + fmtEst(o.created_at),
    '客户：' + orderCustomerName(o),
    '总金额：' + (o.total_price || '') + ' ' + (o.currency || 'USD'),
    '付款状态：' + (o.financial_status || ''),
    '发货状态：' + (o.fulfillment_status || 'unfulfilled（未发货）'),
  ];
  if (items) lines.push('商品：' + items);
  if (tracking.length) lines.push('物流单号：' + tracking.join('、'));
  if (o.note) lines.push('备注：' + o.note);
  return lines.join('\n');
}

// 工具 1：按订单号（name，如 #7180）、客户邮箱、付款/发货状态查订单。
// REST /orders.json 没有按订单号或邮箱筛选的参数，订单号和邮箱在本地过滤（最多翻 3 页、750 单）。
async function toolSearchShopifyOrders(args) {
  if (!shopifyConfigured()) return SHOPIFY_NOT_CONFIGURED;
  const limit = Math.min(Math.max(parseInt(args.limit, 10) || 10, 1), 20);
  const nameQ = String(args.order_number || '').trim().replace(/^#/, '');
  const emailQ = String(args.email || '').trim().toLowerCase();
  const fin = String(args.financial_status || '').trim();
  const ful = String(args.fulfillment_status || '').trim();
  if (!nameQ && !emailQ && !fin && !ful) {
    return '请告诉我订单号（如 #7180）、客户邮箱、付款状态或发货状态，至少给一个条件。';
  }
  const params = { status: 'any', limit: 250 };
  if (fin) params.financial_status = fin;
  if (ful) params.fulfillment_status = ful;
  const matches = [];
  let pageInfo = null;
  let pages = 0;
  while (pages < 3 && matches.length < limit) {
    const p = { ...params };
    if (pageInfo) p.page_info = pageInfo;
    const res = await shopifyFetch('/orders.json', p);
    if (res.error) return res.error;
    const orders = (res.data && res.data.orders) || [];
    for (const o of orders) {
      if (nameQ && String(o.name || '').replace(/^#/, '') !== nameQ) continue;
      if (emailQ) {
        const em = String((o.customer && o.customer.email) || o.email || '').toLowerCase();
        if (!em.includes(emailQ)) continue;
      }
      matches.push(o);
      if (matches.length >= limit) break;
    }
    pageInfo = nextPageInfo(res.link);
    pages++;
    if (!pageInfo || !orders.length) break;
  }
  if (!matches.length) {
    return '在 Shopify 里没有找到符合条件的订单' + (nameQ ? '（订单号 #' + nameQ + '）' : '') + '。按订单号只查了最近的订单，如需查更早的订单请提供下单日期。数据来源：Shopify。';
  }
  return '查到 ' + matches.length + ' 个订单（数据来源：Shopify，时间 EST）：\n' + matches.map(fmtOrderBrief).join('\n---\n');
}

// 工具 2：按日期范围（YYYY-MM-DD，EST）或快捷词 yesterday/today 汇总销售。
async function toolShopifySalesSummary(args) {
  if (!shopifyConfigured()) return SHOPIFY_NOT_CONFIGURED;
  let startDate = String(args.start_date || '').trim();
  let endDate = String(args.end_date || '').trim();
  const range = String(args.range || '').trim().toLowerCase();
  const today = estToday();
  if (range === 'today') { startDate = today; endDate = today; }
  else if (range === 'yesterday') {
    const y = new Date(new Date(today + 'T12:00:00Z').getTime() - 86400000).toISOString().slice(0, 10);
    startDate = y; endDate = y;
  }
  if (!startDate) startDate = endDate || today;
  if (!endDate) endDate = startDate;
  const minISO = estDateStartISO(startDate);
  const nextDay = new Date(new Date(endDate + 'T12:00:00Z').getTime() + 86400000).toISOString().slice(0, 10);
  const maxISO = estDateStartISO(nextDay);
  if (!minISO || !maxISO) return '日期格式不对，请用 YYYY-MM-DD（如 2026-11-07），或用 yesterday / today。';
  const orders = [];
  let pageInfo = null;
  let pages = 0;
  while (pages < 5) {
    const p = { status: 'any', limit: 250, created_at_min: minISO, created_at_max: maxISO };
    if (pageInfo) p.page_info = pageInfo;
    const res = await shopifyFetch('/orders.json', p);
    if (res.error) return res.error;
    const batch = (res.data && res.data.orders) || [];
    orders.push(...batch);
    pageInfo = nextPageInfo(res.link);
    pages++;
    if (!pageInfo || !batch.length) break;
  }
  const valid = orders.filter((o) => !o.cancelled_at);
  const total = valid.reduce((s, o) => s + (parseFloat(o.total_price) || 0), 0);
  const currency = (valid[0] && valid[0].currency) || 'USD';
  const unfulfilled = valid.filter((o) => !o.fulfillment_status || o.fulfillment_status === 'unfulfilled').length;
  const avg = valid.length ? total / valid.length : 0;
  const label = startDate === endDate ? startDate : (startDate + ' 至 ' + endDate);
  return 'Shopify 销售汇总（' + label + '，EST 店铺时间，来源：Shopify，已排除已取消订单）：\n'
    + '订单数：' + valid.length + ' 单\n'
    + '总销售额：' + currency + ' ' + total.toFixed(2) + '\n'
    + '客均价：' + currency + ' ' + avg.toFixed(2) + '\n'
    + '未发货单数：' + unfulfilled + ' 单';
}

// 工具 3：查已付款未发货的订单，最旧的在前。
async function toolListUnfulfilledOrders(args) {
  if (!shopifyConfigured()) return SHOPIFY_NOT_CONFIGURED;
  const limit = Math.min(Math.max(parseInt(args.limit, 10) || 20, 1), 30);
  const orders = [];
  let pageInfo = null;
  let pages = 0;
  while (pages < 3) {
    const p = { status: 'any', financial_status: 'paid', fulfillment_status: 'unfulfilled', limit: 250 };
    if (pageInfo) p.page_info = pageInfo;
    const res = await shopifyFetch('/orders.json', p);
    if (res.error) return res.error;
    const batch = (res.data && res.data.orders) || [];
    orders.push(...batch);
    pageInfo = nextPageInfo(res.link);
    pages++;
    if (!pageInfo || !batch.length) break;
  }
  if (!orders.length) return 'Shopify 里没有已付款未发货的订单（EST 时间口径，来源：Shopify）。';
  orders.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const top = orders.slice(0, limit);
  const lines = top.map((o) => '#' + String(o.name || o.id).replace(/^#/, '')
    + '｜下单 ' + fmtEst(o.created_at)
    + '｜账龄 ' + ageDays(o.created_at) + ' 天'
    + '｜' + (o.total_price || '') + ' ' + (o.currency || 'USD')
    + '｜' + orderCustomerName(o));
  return '已付款未发货订单共 ' + orders.length + ' 单（最旧的在前，来源：Shopify，时间 EST）：\n' + lines.join('\n');
}

// 工具 4：按邮箱或姓名查客户，返回客户信息、最近订单数及累计消费。
async function toolGetShopifyCustomer(args) {
  if (!shopifyConfigured()) return SHOPIFY_NOT_CONFIGURED;
  const email = String(args.email || '').trim();
  const name = String(args.name || '').trim();
  if (!email && !name) return '请提供客户邮箱或姓名。';
  const q = email ? ('email:' + email) : name;
  const res = await shopifyFetch('/customers/search.json', { query: q, limit: 5 });
  if (res.error) return res.error;
  const customers = (res.data && res.data.customers) || [];
  if (!customers.length) {
    return '在 Shopify 里没有找到' + (email ? '邮箱为 ' + email : '姓名含“' + name + '”') + '的客户。数据来源：Shopify。';
  }
  const c = customers[0];
  let recent = '未查到';
  const or = await shopifyFetch('/customers/' + c.id + '/orders.json', { status: 'any', limit: 5 });
  if (!or.error) {
    const os = (or.data && or.data.orders) || [];
    recent = os.length
      ? os.map((o) => '#' + String(o.name || o.id).replace(/^#/, '') + '（' + fmtEst(o.created_at) + '，' + (o.total_price || '') + ' ' + (o.currency || 'USD') + '）').join('、')
      : '无订单记录';
  }
  const fullName = ((c.first_name || '') + ' ' + (c.last_name || '')).trim() || '未留姓名';
  return '客户信息（来源：Shopify）：\n'
    + '姓名：' + fullName + '\n'
    + '邮箱：' + (c.email || '无') + '\n'
    + '电话：' + (c.phone || '无') + '\n'
    + '订单数：' + (c.orders_count || 0) + ' 单\n'
    + '累计消费：' + (c.total_spent || '0') + ' ' + (c.currency || 'USD') + '\n'
    + '最近订单：' + recent;
}

// ---- 飞书工具 ----
// SDK 核实（@larksuiteoapi/node-sdk 1.76.0，见 types/index.d.ts）：
//   - 搜索文件：SDK 没有对应的类型化方法，用 client.request() 调未收录接口
//     POST https://open.feishu.cn/open-apis/drive/v1/files/search
//     （client.request 会自动带 tenant_access_token，返回响应体 {code,msg,data}）
//   - 列文件夹文件：client.drive.file.list({ params: { folder_token, page_size } })
//     （folder_token 为空即列根目录）
//   - 列数据表：client.bitable.appTable.list({ path: { app_token }, params: { page_size } })
//   - 读记录：client.bitable.appTableRecord.search({ path: { app_token, table_id }, params: { page_size }, data: { field_names?, sort?, filter? } })
//     （该版本没有 appTableRecord.list，读记录用 search）
//   - 读 docx 正文：client.docx.document.rawContent({ path: { document_id } }) -> data.content

function feishuErr(res, what) {
  if (!res) return what + '失败：没有返回结果。';
  if (res.code !== 0) {
    return what + '失败（错误码 ' + res.code + '）：' + (res.msg || '未知错误')
      + '。可能是机器人没有该文件的访问权限，请把文件分享给应用「老道_助手测试」后再试。';
  }
  return null;
}

async function toolSearchFeishuFiles({ query, file_type }) {
  if (!query) return '请告诉我搜索关键词，比如表格或文档的名字。';
  const res = await client.request({
    url: 'https://open.feishu.cn/open-apis/drive/v1/files/search',
    method: 'POST',
    data: { query, page_size: 10 },
  });
  const err = feishuErr(res, '搜索飞书文件');
  if (err) return err;
  let files = (res.data && res.data.files) || [];
  if (file_type) files = files.filter((f) => f.type === file_type);
  if (!files.length) {
    return '没有搜到名为“' + query + '”的文件。可能机器人没有这些文件的访问权限，'
      + '请确认文件已分享给应用「老道_助手测试」，或把表格/文档链接直接发给我。';
  }
  return JSON.stringify(files.slice(0, 10).map((f) => ({
    name: f.name, type: f.type, token: f.token, url: f.url,
  })), null, 2);
}

async function toolListFeishuFolder({ folder_token }) {
  const params = { page_size: 50 };
  if (folder_token) params.folder_token = folder_token;
  const res = await client.drive.file.list({ params });
  const err = feishuErr(res, '列出文件夹');
  if (err) return err;
  const files = (res.data && res.data.files) || [];
  if (!files.length) return '这个文件夹里没有文件。可能机器人没有访问权限，请确认文件已分享给应用「老道_助手测试」。';
  return JSON.stringify(files.map((f) => ({
    name: f.name, type: f.type, token: f.token, url: f.url,
  })), null, 2);
}

async function findBitableByName(name) {
  const res = await client.request({
    url: 'https://open.feishu.cn/open-apis/drive/v1/files/search',
    method: 'POST',
    data: { query: name, page_size: 10 },
  });
  const err = feishuErr(res, '搜索多维表格');
  if (err) return { error: err };
  const files = ((res.data && res.data.files) || []).filter((f) => f.type === 'bitable');
  if (!files.length) {
    return { error: '没有搜到名为“' + name + '”的多维表格，请确认表格已分享给应用「老道_助手测试」，或把表格链接直接发给我。' };
  }
  const exact = files.find((f) => f.name === name);
  const hit = exact || files[0];
  return { app_token: hit.token, name: hit.name };
}

async function resolveTable(app_token, table_id, table_name) {
  if (!app_token) {
    if (!table_name) return { error: '请告诉我多维表格的名字或链接，比如“KE 运营日志”。' };
    const found = await findBitableByName(table_name);
    if (found.error) return found;
    app_token = found.app_token;
  }
  if (!table_id) {
    const res = await client.bitable.appTable.list({ path: { app_token }, params: { page_size: 50 } });
    const err = feishuErr(res, '列出数据表');
    if (err) return { error: err };
    const tables = (res.data && res.data.items) || [];
    if (!tables.length) return { error: '这个多维表格里没有数据表。' };
    let t = null;
    if (table_name) {
      t = tables.find((x) => x.name === table_name)
        || tables.find((x) => x.name && x.name.includes(table_name));
    }
    if (!t) t = tables[0];
    table_id = t.table_id;
    table_name = t.name;
  }
  return { app_token, table_id, table_name };
}

function fmtValue(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) {
    return v.map((x) => (x && typeof x === 'object' ? (x.name || x.text || JSON.stringify(x)) : String(x))).join('、');
  }
  if (typeof v === 'object') {
    if (v.text !== undefined) return v.text + (v.link ? '（' + v.link + '）' : '');
    if (v.name !== undefined) return v.name;
    return JSON.stringify(v);
  }
  return String(v);
}

function fmtFields(fields) {
  const out = {};
  for (const k of Object.keys(fields || {})) out[k] = fmtValue(fields[k]);
  return out;
}

async function toolReadBitableRecords(args, reads) {
  const pageSize = Math.min(Math.max(parseInt(args.page_size, 10) || 20, 1), 50);
  const resolved = await resolveTable(args.app_token, args.table_id, args.table_name);
  if (resolved.error) return resolved.error;
  const { app_token, table_id } = resolved;
  const data = {};
  if (args.sort_field) data.sort = [{ field_name: args.sort_field, desc: args.sort_desc !== false }];
  if (args.filter_field && args.filter_value !== undefined && args.filter_value !== '') {
    data.filter = {
      conjunction: 'and',
      conditions: [{ field_name: args.filter_field, operator: 'contains', value: [String(args.filter_value)] }],
    };
  }
  const res = await client.bitable.appTableRecord.search({
    path: { app_token, table_id },
    params: { page_size: pageSize },
    data,
  });
  const err = feishuErr(res, '读取多维表格记录');
  if (err) return err;
  const items = (res.data && res.data.items) || [];
  const total = res.data && res.data.total;
  const title = resolved.table_name || table_id;
  if (!items.length) return '表「' + title + '」里没有符合条件的记录（共 ' + (total || 0) + ' 条）。';
  const rows = items.map((it) => fmtFields(it.fields || {}));
  const out = '表「' + title + '」（共 ' + (total != null ? total : rows.length) + ' 条，本次返回 ' + rows.length + ' 条）：\n'
    + JSON.stringify(rows, null, 2);
  if (reads) reads.push({ source: '多维表格「' + title + '」', type: 'bitable', content: out });
  return out;
}

async function toolReadDocx({ document_id }, reads) {
  if (!document_id) return '请提供文档的 token，可先用搜索工具按文档名查找。';
  const res = await client.docx.document.rawContent({ path: { document_id } });
  const err = feishuErr(res, '读取云文档');
  if (err) return err;
  const content = (res.data && res.data.content) || '';
  if (!content.trim()) return '这篇文档没有正文内容。';
  const out = content.slice(0, 8000);
  if (reads) reads.push({ source: '云文档 docx:' + document_id, type: 'docx', content: out });
  return out;
}

const TOOL_IMPL = {
  search_feishu_files: (args) => toolSearchFeishuFiles(args),
  list_feishu_folder: (args) => toolListFeishuFolder(args),
  list_bitable_tables: async ({ app_token }) => {
    if (!app_token) return '请提供多维表格的 app_token（表格链接里 base/ 后面那段字符）。';
    const res = await client.bitable.appTable.list({ path: { app_token }, params: { page_size: 50 } });
    const err = feishuErr(res, '列出数据表');
    if (err) return err;
    const items = (res.data && res.data.items) || [];
    if (!items.length) return '这个多维表格里没有数据表。';
    return JSON.stringify(items.map((t) => ({ table_id: t.table_id, name: t.name })), null, 2);
  },
  read_bitable_records: (args, reads) => toolReadBitableRecords(args, reads),
  read_docx_content: (args, reads) => toolReadDocx(args, reads),
  search_shopify_orders: (args) => toolSearchShopifyOrders(args),
  shopify_sales_summary: (args) => toolShopifySalesSummary(args),
  list_unfulfilled_orders: (args) => toolListUnfulfilledOrders(args),
  get_shopify_customer: (args) => toolGetShopifyCustomer(args),
  crm_find_customer: (args, _reads, context) => crmReadonly.findCustomer(args, context),
  crm_list_segment: (args, _reads, context) => crmReadonly.listSegment(args, context),
  crm_customer_communications: (args, _reads, context) => crmReadonly.customerCommunications(args, context),
};

async function runTool(name, args, reads, context) {
  const fn = TOOL_IMPL[name];
  if (!fn) return '没有这个工具：' + name + '。';
  try {
    const out = await fn(args || {}, reads, context);
    return typeof out === 'string' ? out : JSON.stringify(out);
  } catch (e) {
    console.error('[feishu-bot] tool failed', name, e.message);
    return '调用' + name + '时出错：' + (e.message || '未知错误') + '。请稍后再试，或把表格链接直接发给我。';
  }
}

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'crm_find_customer',
      description: '通过飞书正式CRM客户档案，按邮箱、完整Shopify Customer GID或姓名查客户。提供CRM等级、RFM、180天M/R/F、两种复购口径、订阅、负责人和生命周期。仅授权单聊。',
      parameters: { type: 'object', properties: {
        email: { type: 'string', description: '精确客户邮箱' },
        shopify_customer_id: { type: 'string', description: '完整 gid://shopify/Customer/数字' },
        name: { type: 'string', description: '客户姓名（可能出现同名，需要进一步消歧）' },
      }, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'crm_list_segment',
      description: '查询正式飞书CRM某个已计算等级或RFM八类分群的客户名单。每次只选一种分群，严格只查询客户数据状态为有效的记录，最多20条；不把部分名单当作完整名单。仅授权单聊。',
      parameters: { type: 'object', properties: {
        crm_grade: { type: 'string', enum: ['S+', 'S', 'A', 'B', '基础客户', '沉睡', '从未购买'] },
        rfm_group: { type: 'string', enum: ['重要价值用户', '重要保持用户', '重要发展用户', '一般发展用户', '重要挽留用户', '一般挽留用户', '一般价值用户', '一般保持用户'] },
        limit: { type: 'integer', description: '展示条数，默认10，最多20' },
      }, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'crm_customer_communications',
      description: '根据精确客户邮箱查询飞书CRM客户沟通与跟进记录（摘要、问题、任务状态），不是Gmail原始全量。仅授权单聊。',
      parameters: { type: 'object', properties: {
        email: { type: 'string', description: '精确客户邮箱' },
        limit: { type: 'integer', description: '最多10条，默认5条' },
      }, required: ['email'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_feishu_files',
      description: '按关键词搜索公司飞书云空间里的文档和多维表格，返回名称、类型、token 和链接。用户问“找一下XX表/XX文档”时先用它定位。只能搜到已分享给机器人应用「老道_助手测试」的文件。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索关键词，如“KE 运营日志”' },
          file_type: { type: 'string', enum: ['', 'docx', 'bitable', 'sheet', 'doc', 'folder'], description: '限定文件类型，留空为全部' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_feishu_folder',
      description: '列出指定飞书文件夹里的文件（文档和多维表格），返回名称、类型、token 和链接。folder_token 为空时列根目录。用户要求把若干文档逐一打开总结归纳时，先用它（或搜索工具）列出文档清单，再逐个读取。',
      parameters: {
        type: 'object',
        properties: {
          folder_token: { type: 'string', description: '文件夹 token，列根目录时留空' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_bitable_tables',
      description: '列出指定多维表格应用（app_token）里的数据表，返回 table_id 和表名。已知多维表格的 app_token 但不知道里面有哪些数据表时用。',
      parameters: {
        type: 'object',
        properties: {
          app_token: { type: 'string', description: '多维表格的 app_token，即表格链接里 base/ 后面那段字符' },
        },
        required: ['app_token'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_bitable_records',
      description: '读取多维表格某张数据表的记录。可以用表名自动定位：只给 table_name 时会先搜索同名多维表格、再列出数据表匹配；也可以直接给 app_token 和 table_id。返回记录的字段内容和总条数。',
      parameters: {
        type: 'object',
        properties: {
          app_token: { type: 'string', description: '多维表格 app_token，可空（给 table_name 时自动搜索定位）' },
          table_id: { type: 'string', description: '数据表 ID，可空（不给则按表名匹配，匹配不到用第一张表）' },
          table_name: { type: 'string', description: '多维表格或数据表的名字，如“KE 运营日志”“月度利润表”' },
          page_size: { type: 'integer', description: '一次读几条，默认 20，最多 50' },
          sort_field: { type: 'string', description: '按哪个字段排序（字段名，如“日期”）' },
          sort_desc: { type: 'boolean', description: '排序是否倒序，默认 true' },
          filter_field: { type: 'string', description: '筛选字段名（可选）' },
          filter_value: { type: 'string', description: '筛选值，只返回该字段包含此值的记录（可选）' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_docx_content',
      description: '读取一篇飞书云文档（docx）的正文纯文本。需要文档的 token（document_id），可先用 search_feishu_files 搜索拿到。',
      parameters: {
        type: 'object',
        properties: {
          document_id: { type: 'string', description: '文档 token' },
        },
        required: ['document_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_shopify_orders',
      description: '在 Shopify 里按订单号、客户邮箱、付款状态、发货状态查订单。返回订单号、下单时间（EST 店铺时间）、客户名、总金额、币种、付款状态、发货状态、商品概要，有物流单号时附上。数据来源是 Shopify。',
      parameters: {
        type: 'object',
        properties: {
          order_number: { type: 'string', description: '订单号，如 #7180' },
          email: { type: 'string', description: '客户邮箱' },
          financial_status: { type: 'string', description: '付款状态，如 paid、pending、refunded、voided' },
          fulfillment_status: { type: 'string', description: '发货状态，如 unfulfilled、partial、fulfilled' },
          limit: { type: 'integer', description: '一次返回几单，默认 10，最多 20' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'shopify_sales_summary',
      description: '按日期范围汇总 Shopify 销售：订单数、总销售额、客均价、未发货单数。日期按 EST 店铺时间算，可用 start_date/end_date（YYYY-MM-DD）或快捷词 range（yesterday/today）。已排除已取消订单，销售口径以 Shopify 为准。',
      parameters: {
        type: 'object',
        properties: {
          start_date: { type: 'string', description: '开始日期 YYYY-MM-DD，如 2026-11-07' },
          end_date: { type: 'string', description: '结束日期 YYYY-MM-DD，如 2026-11-07' },
          range: { type: 'string', description: '快捷词：yesterday（昨天）或 today（今天），给了 range 就不用给日期' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_unfulfilled_orders',
      description: '列出 Shopify 里已付款未发货的订单，最旧的在前。返回订单号、下单日期（EST）、账龄天数、金额、客户名。用户问“还有多少单没发货”“最旧的未发货单是哪单”时用它。',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'integer', description: '一次返回几单，默认 20，最多 30' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_shopify_customer',
      description: '在 Shopify 里按邮箱或姓名查客户，返回客户信息、订单数、累计消费和最近订单。',
      parameters: {
        type: 'object',
        properties: {
          email: { type: 'string', description: '客户邮箱' },
          name: { type: 'string', description: '客户姓名' },
        },
        required: [],
      },
    },
  },
];

// ---- GPT 调用（带工具循环） ----
async function callOpenAI(messages, options) {
const opts = options || {};
const model = opts.model || OPENAI_MODEL;
const temperature = opts.temperature!== undefined? opts.temperature: 0.7;
const maxTokens = opts.maxTokens || 1500;
const ctrl = new AbortController();
const timer = setTimeout(() => ctrl.abort(), 25000);
try {
const body = {
model, temperature, max_tokens: maxTokens,
messages,
};
if (opts.tools!== null) { body.tools = TOOLS; body.tool_choice = 'auto';}
const r = await fetch(OPENAI_URL, {
method: 'POST',
headers: { Authorization: 'Bearer ' + OPENAI_API_KEY, 'Content-Type': 'application/json'},
body: JSON.stringify(body),
signal: ctrl.signal,
});
const d = await r.json();
if (!r.ok) throw new Error('OpenAI ' + r.status + ': ' + (d.error?.message || 'request failed'));
return d;
} finally { clearTimeout(timer);}
}

async function askChatGPT(userText, chatId, context) {
if (!OPENAI_API_KEY) return { reply: null, reads: []};
// 对话记忆：本次会话最近 20 条 + 知识库匹配到的相关条目一起带上。
const history = loadHistory(chatId);
const kbHits = searchKB(userText, loadKB());
let system = SYSTEM_PROMPT + '\n' + CRM_PROMPT;
if (kbHits.length) {
system += '\n\n' + formatKBHits(kbHits);
}
const messages = [{ role: 'system', content: system},...history];
const reads = [];
let reply = null;
for (let round = 0; round < 8; round++) {
const d = await callOpenAI(messages);
const msg = d.choices?.[0]?.message;
if (!msg) { reply = '我收到你的消息了，但这次没有生成出回复，请再说一次。'; break; }
messages.push(msg);
const calls = msg.tool_calls || [];
if (!calls.length) {
reply = (msg.content || '').trim() || '我收到你的消息了，但这次没有生成出回复，请再说一次。';
break;
}
for (const call of calls) {
const name = call.function?.name || '';
let args = {};
try { args = JSON.parse(call.function?.arguments || '{}');} catch { args = {};}
console.log('[feishu-bot] tool call:', name, name.startsWith('crm_') ? '[CRM arguments redacted]' : JSON.stringify(args).slice(0, 200));
const result = await runTool(name, args, reads, context);
messages.push({ role: 'tool', tool_call_id: call.id, content: String(result).slice(0, 8000)});
}
}
if (!reply) reply = '我查了相关资料，但这次没能整理出完整回复，请换个问法再试一次。';
// 深度分析：用户要求全面归纳且本轮确实读到了文档时，用更强模型多做一次合并分析，替代摘录式回复。
if (wantsDeepAnalysis(userText) && reads.length) {
const analysis = await runDeepAnalysis(userText, reads);
if (analysis) reply = analysis;
}
return { reply, reads};
}

// ---- 消息发送与处理 ----
async function sendText(chatId, text) {
await client.im.message.create({
params: { receive_id_type: 'chat_id'},
data: {
receive_id: chatId,
msg_type: 'text',
content: JSON.stringify({ text: text.slice(0, 4000)}),
},
});
}

// ---- Markdown 转飞书富文本 post ----
// 支持 # / ## / ### 标题、**加粗**、- 无序列表、1. 有序列表、普通段落。
function inlineSegments(text) {
const segs = [];
const parts = String(text).split(/(\*\*[^*]+\*\*)/g);
for (const p of parts) {
if (!p) continue;
const m = /^\*\*([^*]+)\*\*$/.exec(p);
if (m) segs.push({ tag: 'text', text: m[1], style: ['bold'] });
else segs.push({ tag: 'text', text: p });
}
return segs.length ? segs : [{ tag: 'text', text: '' }];
}

function markdownToPost(md) {
const lines = String(md || '').slice(0, 4000).split('\n');
let title = '老道助手测试的回复';
const content = [];
let first = true;
for (const raw of lines) {
const line = raw.replace(/\s+$/, '');
if (!line.trim()) continue;
const h = /^(#{1,3})\s+(.*)$/.exec(line);
if (h) {
const heading = h[2].replace(/\*\*/g, '').trim();
if (first) { title = heading || title; first = false; continue; } // 第一行标题进 post 标题，正文不再重复
content.push([{ tag: 'text', text: heading, style: ['bold'] }]);
first = false;
continue;
}
if (first) { title = line.replace(/\*\*/g, '').trim().slice(0, 100) || title; first = false; }
const ul = /^[-*•]\s+(.*)$/.exec(line);
if (ul) { content.push([{ tag: 'text', text: '• ' }].concat(inlineSegments(ul[1]))); continue; }
const ol = /^(\d+)[.、]\s+(.*)$/.exec(line);
if (ol) { content.push([{ tag: 'text', text: ol[1] + '. ' }].concat(inlineSegments(ol[2]))); continue; }
content.push(inlineSegments(line));
}
if (!content.length) throw new Error('empty post content');
return { zh_cn: { title: title.slice(0, 100), content } };
}

// 回复优先用富文本 post，转换或发送失败时回退到 text 消息。
async function sendReply(chatId, text) {
const clipped = String(text || '').slice(0, 4000);
try {
const post = markdownToPost(clipped);
await client.im.message.create({
params: { receive_id_type: 'chat_id' },
data: {
receive_id: chatId,
msg_type: 'post',
content: JSON.stringify(post),
},
});
} catch (e) {
console.error('[feishu-bot] send post failed, fallback to text:', e.message);
await sendText(chatId, clipped);
}
}

// 从收到的消息里提取纯文字：text 类型取 content.text；post（富文本）类型取标题和各行元素的 text；
// 图片、文件、语音、视频、表情等其他类型返回 null（调用方回“只支持文字消息”提示）。
function extractMessageText(message) {
const type = message.message_type;
if (type === 'text') {
try { return JSON.parse(message.content || '{}').text || ''; } catch { return ''; }
}
if (type === 'post') {
try {
const c = JSON.parse(message.content || '{}');
const lines = [];
if (c.title) lines.push(String(c.title));
const rows = Array.isArray(c.content) ? c.content : [];
for (const row of rows) {
if (!Array.isArray(row)) continue;
const parts = [];
for (const el of row) {
if (el && typeof el.text === 'string') parts.push(el.text);
}
lines.push(parts.join(''));
}
return lines.join('\n');
} catch { return ''; }
}
return null;
}

const seen = new Set();
function alreadySeen(id) {
if (!id) return false;
if (seen.has(id)) return true;
seen.add(id);
if (seen.size > 200) seen.delete(seen.values().next().value);
return false;
}

async function handleMessage(data) {
const message = data.message || {};
const sender = data.sender || {};
const chatId = message.chat_id;
if (!chatId) return;
if (alreadySeen(message.message_id)) return;
if (sender.sender_type === 'app') return; // ignore own / other bots' messages

const chatType = message.chat_type || 'p2p';
const mentions = message.mentions || [];
if (chatType!== 'p2p' && mentions.length === 0) return; // group: only reply when @mentioned
// 文字消息直接取 text；富文本（post）消息从 content JSON 里提取纯文字（标题 + 各行 text 字段）。
let text = extractMessageText(message);
if (text === null) {
try { await sendText(chatId, '目前我只支持文字消息，请发文字给我。');} catch (e) { console.error('[feishu-bot] reply failed', e.message);}
return;
}
text = text.replace(/@_user_\d+/g, '').trim();
if (!text) return;

console.log('[feishu-bot] got message in', chatId, ':', text.slice(0, 80));
// 先把用户这条消息记入对话历史。
saveHistory(chatId, [...loadHistory(chatId), { role: 'user', content: text}]);
try {
const { reply, reads} = await askChatGPT(text, chatId, { chatType, senderOpenId: sender.sender_id?.open_id });
let finalReply = reply;
if (!finalReply) finalReply = '我已收到你的消息：“' + text.slice(0, 100) + '”。但 ChatGPT 还没配好，缺少 OPENAI_API_KEY，配好后我就能正常回答了。';
await sendReply(chatId, finalReply);
// 再把助手这条回复记入对话历史。
saveHistory(chatId, [...loadHistory(chatId), { role: 'assistant', content: finalReply}]);
// 后台把本轮读到的文档/表格内容摘要存入知识库（不阻塞回复）。
updateKBFromReads(reads).catch((e) => console.error('[feishu-bot] KB update failed', e.message));
} catch (e) {
console.error('[feishu-bot] handle failed', e.message);
try { await sendReply(chatId, '抱歉，这次处理出错了，请稍后再试一次。');} catch {}
}
}

const eventDispatcher = new lark.EventDispatcher({}).register({
'im.message.receive_v1': handleMessage,
});

const wsClient = new lark.WSClient({
appId: APP_ID,
appSecret: APP_SECRET,
domain: lark.Domain.Feishu,
loggerLevel: lark.LoggerLevel.info,
});

wsClient.start({ eventDispatcher}).then(() => {
console.log('[feishu-bot] long connection started, waiting for messages...');
}).catch((e) => {
console.error('[feishu-bot] failed to start long connection:', e.message);
process.exit(1);
});

process.on('SIGINT', () => { console.log('[feishu-bot] stopping...'); process.exit(0);});
process.on('SIGTERM', () => { console.log('[feishu-bot] stopping...'); process.exit(0);});

// 导出纯函数供本地测试（生产运行 node server-v4.js 时无影响）。
module.exports = { extractMessageText, markdownToPost, inlineSegments, wantsDeepAnalysis, sendReply, sendText, shopifyConfigured, estToday, fmtEst, toolSearchShopifyOrders, toolShopifySalesSummary, toolListUnfulfilledOrders, toolGetShopifyCustomer };
