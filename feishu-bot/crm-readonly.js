'use strict';

// CRM is stored in Feishu Bitable. This module never writes records and never
// reads Vercel Blob, Shopify, Gmail, or a local customer cache.
const APP_TOKEN = 'Y7VvbgreAasoLtsYdhrcmmDUn5d';
const CUSTOMERS = 'tblbk7Ju6fcM1BXF';
const CONTACTS = 'tblNi7C5q5FYlG06';
const CRM_GRADES = new Set(['S+', 'S', 'A', 'B', '基础客户', '沉睡', '从未购买']);
const RFM_GROUPS = new Set([
  '重要价值用户', '重要保持用户', '重要发展用户', '一般发展用户',
  '重要挽留用户', '一般挽留用户', '一般价值用户', '一般保持用户',
]);

function text(value) {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map((item) => text(item?.text ?? item?.name ?? item)).join('、');
  if (typeof value === 'object') return text(value.text ?? value.name ?? '');
  return '';
}

function number(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function date(value) {
  if (!value) return '未记录';
  const parsed = new Date(typeof value === 'number' ? value : value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : '未记录';
}

function customerProjection(fields) {
  const f = fields || {};
  const grade = text(f['CRM等级']) || '尚未完成计算';
  const rfm = text(f['RFM价值分群']) || '尚未完成计算';
  return {
    客户姓名: text(f['客户姓名']) || '未记录',
    邮箱: text(f['邮箱']) || '未记录',
    Shopify客户ID: text(f['Shopify客户ID']),
    CRM等级: grade,
    RFM价值分群: rfm,
    近180天净消费USD: number(f['近180天净消费']) ?? '待计算',
    近180天有效订单数: number(f['近180天有效订单数']) ?? '待计算',
    最近购买距今天数R: number(f['最近购买距今天数R']) ?? '待计算',
    历史订单数: number(f['历史订单数']) ?? '未记录',
    近180天是否复购: number(f['近180天有效订单数']) === null
      ? '待计算' : number(f['近180天有效订单数']) >= 2 ? '是' : '否',
    历史是否复购: number(f['历史订单数']) === null
      ? '待核验' : number(f['历史订单数']) >= 2 ? '是' : '否',
    客单价分组: text(f['客单价分组']) || '未计算',
    邮件订阅状态: text(f['邮件订阅状态']) || '待确认',
    负责人: text(f['负责人']) || '未分配',
    客户关系健康度: text(f['客户关系健康度']) || '待核验',
    客户旅程阶段: text(f['客户旅程阶段']) || '未记录',
    首次订阅时间: date(f['首次订阅时间']),
    首次下单时间: date(f['首次下单时间']),
    建议下一次维护日期: date(f['建议下一次维护日期']),
    推荐维护动作: text(f['推荐维护动作']) || '待CRM负责人判断',
    客户数据状态: text(f['客户数据状态']) || '待核验',
  };
}

function communicationProjection(fields) {
  const f = fields || {};
  return {
    记录时间: date(f['记录时间']),
    沟通渠道: text(f['沟通渠道']) || '未分类',
    邮件主题: text(f['邮件主题']),
    沟通摘要: text(f['沟通摘要']),
    问题类别: text(f['问题类别']) || '未分类',
    任务状态: text(f['任务状态']) || '待核验',
    负责人: text(f['负责人']) || '未分配',
    下一步行动: text(f['下一步行动']),
    截止日期: date(f['截止日期']),
  };
}

function condition(field, operator, value) {
  return { field_name: field, operator, value: [value] };
}

function createCrmReadonly(client, { allowedOpenIds = process.env.CRM_ALLOWED_OPEN_IDS || '' } = {}) {
  const allowed = new Set(allowedOpenIds.split(',').map((s) => s.trim()).filter(Boolean));

  function authorize(context) {
    if (context?.chatType !== 'p2p') return 'CRM包含客户隐私，请在授权的飞书单聊中查询。';
    if (!context?.senderOpenId || !allowed.has(context.senderOpenId)) {
      return '当前账号未获CRM只读查询授权。请管理员在服务器配置 CRM_ALLOWED_OPEN_IDS（飞书 open_id 白名单）。';
    }
    return null;
  }

  async function search(tableId, conditions, pageSize) {
    const params = { page_size: Math.min(Math.max(pageSize || 10, 1), 20) };
    const res = await client.bitable.appTableRecord.search({
      path: { app_token: APP_TOKEN, table_id: tableId },
      params,
      data: { filter: { conjunction: 'and', conditions } },
    });
    if (!res || res.code !== 0) {
      const code = res?.code ?? 'unknown';
      return { error: `读取CRM失败（飞书错误码 ${code}）。请核实机器人应用是否已获目标Bitable授权。` };
    }
    return { items: res.data?.items || [], total: res.data?.total, hasMore: Boolean(res.data?.has_more) };
  }

  async function findCustomer(args, context) {
    const denied = authorize(context); if (denied) return denied;
    const email = String(args.email || '').trim().toLowerCase();
    const customerId = String(args.shopify_customer_id || '').trim();
    const name = String(args.name || '').trim();
    if ([email, customerId, name].filter(Boolean).length !== 1) return '请只提供一个查询条件：邮箱、Shopify客户ID或姓名。';
    if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) return '邮箱格式不正确。';
    if (customerId && !/^gid:\/\/shopify\/Customer\/\d+$/.test(customerId)) return '请提供完整 Shopify Customer GID。';
    if (name && (name.length < 2 || name.length > 80)) return '姓名长度须为2–80个字符。';
    const filter = email ? condition('邮箱', 'is', email)
      : customerId ? condition('Shopify客户ID', 'is', customerId)
        : condition('客户姓名', 'contains', name);
    const result = await search(CUSTOMERS, [filter], 10);
    if (result.error) return result.error;
    const rows = result.items.filter((r) => text(r.fields?.['客户数据状态']) === '有效');
    if (!rows.length) return 'CRM客户档案中未找到已核验的匹配客户。来源：飞书CRM。';
    if (rows.length > 1) return `找到 ${rows.length} 条有效匹配记录，存在同名或重复匹配；请提供客户邮箱或完整Shopify客户ID后再查询，未自动合并。`;
    return '来源：飞书CRM客户档案；复购分历史和近180天两种口径。\n'
      + JSON.stringify(customerProjection(rows[0].fields), null, 2);
  }

  async function listSegment(args, context) {
    const denied = authorize(context); if (denied) return denied;
    const grade = String(args.crm_grade || '').trim();
    const rfm = String(args.rfm_group || '').trim();
    if (Boolean(grade) === Boolean(rfm)) return '请提供CRM等级或RFM分群，且每次只查询其中一种。';
    if (grade && !CRM_GRADES.has(grade)) return '不支持的CRM等级。';
    if (rfm && !RFM_GROUPS.has(rfm)) return '不支持的RFM分群名称。';
    const limit = Math.min(Math.max(Number.parseInt(args.limit, 10) || 10, 1), 20);
    const conditions = [condition('客户数据状态', 'is', '有效'),
      condition(grade ? 'CRM等级' : 'RFM价值分群', 'is', grade || rfm)];
    const result = await search(CUSTOMERS, conditions, limit);
    if (result.error) return result.error;
    const records = result.items.map((r) => ({
      姓名: text(r.fields?.['客户姓名']) || '未记录',
      Shopify客户ID: text(r.fields?.['Shopify客户ID']),
      等级: text(r.fields?.['CRM等级']) || '尚未完成计算',
      RFM: text(r.fields?.['RFM价值分群']) || '尚未完成计算',
      负责人: text(r.fields?.['负责人']) || '未分配',
    }));
    const total = typeof result.total === 'number' ? String(result.total) : '未提供';
    return `来源：飞书CRM客户档案；筛选：${grade || rfm}；匹配总数：${total}；本次仅展示 ${records.length} 条，不代表全部名单。\n`
      + JSON.stringify(records, null, 2);
  }

  async function customerCommunications(args, context) {
    const denied = authorize(context); if (denied) return denied;
    const email = String(args.email || '').trim().toLowerCase();
    if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return '请提供有效客户邮箱。';
    const result = await search(CONTACTS, [condition('客户邮箱', 'is', email)], Math.min(Math.max(Number(args.limit) || 5, 1), 10));
    if (result.error) return result.error;
    if (!result.items.length) return '该客户在飞书CRM沟通表中暂无匹配记录。';
    const rows = result.items.map((r) => communicationProjection(r.fields));
    return `来源：飞书CRM客户沟通与跟进；本次返回 ${rows.length} 条（不是全部历史记录）。\n`
      + JSON.stringify(rows, null, 2);
  }

  return { findCustomer, listSegment, customerCommunications };
}

module.exports = { createCrmReadonly, customerProjection, communicationProjection, CRM_GRADES, RFM_GROUPS };
