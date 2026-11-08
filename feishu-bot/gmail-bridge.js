'use strict';

const crypto = require('crypto');

const DEFAULT_URL = 'https://kailash-energy-ai-knowledge-hub.vercel.app/api/crm-gmail-bridge';

function createGmailBridge({
  url = process.env.GMAIL_BRIDGE_URL || DEFAULT_URL,
  secret = process.env.FEISHU_APP_SECRET,
  allowedOpenIds = process.env.CRM_ALLOWED_OPEN_IDS || '',
  lookupCustomer = null,
} = {}) {
  const allowed = new Set(allowedOpenIds.split(',').map((s) => s.trim()).filter(Boolean));

  async function archivedCases(limit) {
    const destination = new URL(url);
    if (destination.protocol !== 'https:') return null;
    destination.pathname = '/api/crm-cases';
    destination.search = '';
    destination.searchParams.set('limit', String(limit));
    const timestamp = String(Date.now());
    const signature = crypto.createHmac('sha256', secret)
      .update(`${timestamp}\n/api/crm-cases\n${limit}`).digest('hex');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    try {
      const response = await fetch(destination, {
        headers: { 'x-kailash-timestamp': timestamp, 'x-kailash-signature': `sha256=${signature}`, accept: 'application/json' },
        signal: controller.signal, redirect: 'error',
      });
      if (!response.ok) return null;
      const data = await response.json();
      return Array.isArray(data.cases) && data.cases.length ? data : null;
    } catch { return null; }
    finally { clearTimeout(timer); }
  }

  function formatCases(data) {
    const groups = ['未收到货','退回寄件人','商品售后','尺寸售后','退款退货','支付争议','物流询单','订单修改','订单咨询','其他客户咨询'];
    const rows = data.cases || [];
    const output = [
      '# 📮 客户 Case 跟进台',
      `**云端事件样本** ${data.scannedEvents} 条｜**归并 Case** ${data.caseCountWithinScan} 件｜**展示** ${rows.length} 件`,
      '⚠️ Case 为待核验工作候选，客服已回复不等于问题已解决；此处不是全邮箱未处理总量。',
    ];
    let index = 0;
    for (const group of groups) {
      const selected = rows.filter(c => c.category === group);
      if (!selected.length) continue;
      output.push(`\n## ${group} · ${selected.length} 件`);
      for (const c of selected) {
        index++;
        const level = c.priority === 'P0' ? '🔴 紧急' : c.priority === 'P1' ? '🟠 优先' : '🔵 常规';
        output.push(`**${index}. ${level}｜${c.crmVerified ? c.crmGrade : '待核验'}｜${c.customerName || c.customerEmail}**`);
        output.push(`**Case：** ${c.caseId}｜**订单：** ${c.orderNumber || '待核对'}｜**邮件：** ${c.messageCount} 封`);
        output.push(`**主题：** ${c.subject || '无'}｜**时间：** ${String(c.receivedAt||'').replace('T',' ').slice(0,16)}`);
        output.push(`**问题摘要：** ${c.summary || '需人工确认'}`);
        output.push(`**回复状态：** ${c.replyStatus || '待核验'}｜**任务状态：** ${c.status || '待分配'}`);
        output.push(`**建议处理：** ${c.nextAction || '人工复核'} `);
        const body = String(c.originalExcerpt || '暂无摘录').replace(/\s+/g,' ').trim();
        output.push(`**客户原文：** “${body.slice(0,350)}${body.length>350?'…（原文较长）':''}”`);
        output.push(`**关联邮箱：** ${(c.emails||[c.customerEmail]).join('、')}`);
      }
    }
    output.push('**注：** 客服任务分配与最终处理结果尚未回写，不能将已回复误判为已解决。');
    return output.filter(Boolean).join('\n').slice(0,7800);
  }

  async function pendingCustomerEmails(args = {}, context = {}) {
    if (context.chatType !== 'p2p') return 'Gmail涉及客户隐私，请在飞书授权单聊中查询。';
    if (!context.senderOpenId || !allowed.has(context.senderOpenId)) {
      return '当前飞书账号未获Gmail客户邮件查询授权，请管理员设置CRM_ALLOWED_OPEN_IDS白名单。';
    }
    if (!secret) return 'Gmail桥接签名配置缺失，请管理员检查FEISHU_APP_SECRET。';
    const limit = Math.min(Math.max(Number.parseInt(args.limit, 10) || 10, 1), 20);
    const ledger = await archivedCases(limit);
    if (ledger) return formatCases(ledger);
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
    const rows = await Promise.all(data.messages.map(async (m) => {
      let grade = '待核验';
      let name = '';
      if (lookupCustomer && m.from) {
        try {
          const record = await lookupCustomer(m.from, context);
          const json = String(record || '').match(/\{[\s\S]*\}/)?.[0];
          const customer = json ? JSON.parse(json) : null;
          if (customer && customer.邮箱?.toLowerCase() === m.from.toLowerCase() && customer.客户数据状态 === '有效') {
            name = customer.客户姓名 || '';
            grade = /^(S\+|S|A|B|基础客户|沉睡|从未购买)$/.test(customer.CRM等级) ? customer.CRM等级 : '待核验';
          }
        } catch { /* Missing CRM data is not permission to infer a tier. */ }
      }
      return {...m, grade, name};
    }));
    const gradeRank = {'S+':0,S:1,A:2,B:3};
    const priorityRank = {P0:0,P1:1,P2:2};
    rows.sort((a,b) => priorityRank[a.priority]-priorityRank[b.priority]
      || (gradeRank[a.grade]??4)-(gradeRank[b.grade]??4)
      || String(b.date).localeCompare(String(a.date)));
    const groups = ['未收到货','商品售后','退款退货','支付争议','物流询单','订单修改','订单咨询','其他客户咨询'];
    const output = [
      '# 📮 客户邮件优先处理台',
      `**本次扫描** ${data.scanned} 封｜**客户会话候选** ${data.candidateCountWithinScan} 条｜**展示** ${rows.length} 条`,
      '⚠️ 这是最近30天未读候选，不等于已确认的未处理总数。系统通知已剔除，客服是否回复仍待核对。',
      data.hasMore ? '⚠️ 扫描未覆盖全部邮件，统计并非邮箱总量。' : '',
    ];
    let index = 0;
    for (const group of groups) {
      const items = rows.filter(m => (m.category || '其他客户咨询') === group);
      if (!items.length) continue;
      output.push(`\n## ${group} · ${items.length} 封`);
      for (const m of items) {
        index += 1;
        const level = m.priority === 'P0' ? '🔴 紧急' : m.priority === 'P1' ? '🟠 优先' : '🔵 常规';
        output.push(`**${index}. ${level}｜${m.grade}｜${m.name || m.from}**`);
        output.push(`**主题：** ${m.subject || '（无主题）'}｜**时间：** ${String(m.date || '').replace('T',' ').slice(0,16)}`);
        output.push(`**问题摘要：** ${m.summary || '需阅读来信确认'}`);
        const original = String(m.original || m.snippet || '正文暂未取到').replace(/\s+/g,' ').trim();
        output.push(`**客户原文：** “${original.slice(0, 310)}${original.length > 310 ? '…（原文较长）' : ''}”`);
        output.push(`**邮箱：** ${m.from}`);
      }
    }
    output.push('**排序依据：** 问题紧急度 → 已核验CRM等级 S+/S/A/B → 时间；缺等级显示“待核验”。');
    return output.filter(Boolean).join('\n').slice(0,7800);
  }

  return { pendingCustomerEmails };
}

module.exports = { createGmailBridge };
