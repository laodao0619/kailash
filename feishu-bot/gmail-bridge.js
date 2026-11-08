'use strict';

const crypto = require('crypto');

const DEFAULT_URL = 'https://kailash-energy-ai-knowledge-hub.vercel.app/api/crm-gmail-bridge';

function createGmailBridge({
  url = process.env.GMAIL_BRIDGE_URL || DEFAULT_URL,
  secret = process.env.FEISHU_APP_SECRET,
  allowedOpenIds = process.env.CRM_ALLOWED_OPEN_IDS || '',
} = {}) {
  const allowed = new Set(allowedOpenIds.split(',').map((s) => s.trim()).filter(Boolean));

  async function pendingCustomerEmails(args = {}, context = {}) {
    if (context.chatType !== 'p2p') return 'Gmail涉及客户隐私，请在飞书授权单聊中查询。';
    if (!context.senderOpenId || !allowed.has(context.senderOpenId)) {
      return '当前飞书账号未获Gmail客户邮件查询授权，请管理员设置CRM_ALLOWED_OPEN_IDS白名单。';
    }
    if (!secret) return 'Gmail桥接签名配置缺失，请管理员检查FEISHU_APP_SECRET。';
    const limit = Math.min(Math.max(Number.parseInt(args.limit, 10) || 10, 1), 20);
    const destination = new URL(url);
    if (destination.protocol !== 'https:') return 'Gmail桥接地址必须使用HTTPS。';
    destination.searchParams.set('limit', String(limit));
    const timestamp = String(Date.now());
    const signature = crypto.createHmac('sha256', secret)
      .update(`${timestamp}\n/api/crm-gmail-bridge\n${limit}`).digest('hex');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    let response;
    try {
      response = await fetch(destination, {
        headers: {
          'x-kailash-timestamp': timestamp,
          'x-kailash-signature': `sha256=${signature}`,
          accept: 'application/json',
        },
        redirect: 'error', signal: controller.signal,
      });
    } catch {
      return 'Gmail只读桥接暂时无法连接，请检查Vercel部署或网络。';
    } finally {
      clearTimeout(timeout);
    }
    if (response.status === 401) return 'Gmail桥接鉴权失败，请核对两端FEISHU_APP_SECRET是否属于同一应用。';
    if (!response.ok) return `Gmail桥接查询失败（HTTP ${response.status}），请稍后重试。`;
    const data = await response.json().catch(() => null);
    if (!data?.ok || !Array.isArray(data.messages)) return 'Gmail桥接返回数据格式异常。';
    const rows = data.messages.map((m) => ({
      优先级: m.priority, 发件人: m.from, 主题: m.subject,
      时间: m.date, 摘要: m.snippet,
    }));
    return `来源：Gmail（${data.mailbox || '客服邮箱'}）。范围：最近30天收件箱未读，已过滤广告和自动通知。`
      + `本次扫描 ${data.scanned} 封，识别 ${data.candidateCountWithinScan} 条不同会话的候选客户邮件，展示 ${rows.length} 条。`
      + (data.hasMore ? '还有未扫描的邮件，以上绝非邮箱总量。' : '')
      + '“未读”不等于“未处理”；是否已回复需要结合发件箱或工单继续核对。\n'
      + JSON.stringify(rows, null, 2);
  }

  return { pendingCustomerEmails };
}

module.exports = { createGmailBridge };
