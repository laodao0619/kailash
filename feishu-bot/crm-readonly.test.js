'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { createCrmReadonly, customerProjection } = require('./crm-readonly');

function mock(items, total = items.length) {
  const calls = [];
  const client = { bitable: { appTableRecord: { search: async (input) => {
    calls.push(input);
    return { code: 0, data: { items, total } };
  } } } };
  return { client, calls };
}
const allowed = { chatType: 'p2p', senderOpenId: 'ou_allowed' };
const row = (fields) => ({ fields: { 客户数据状态: '有效', ...fields } });

test('denies by default, in group chats and for unauthorized senders without API reads', async () => {
  const m = mock([]);
  const crm = createCrmReadonly(m.client, { allowedOpenIds: '' });
  assert.match(await crm.findCustomer({ email: 'a@example.com' }, allowed), /未获CRM/);
  assert.equal(m.calls.length, 0);
  const authorized = createCrmReadonly(m.client, { allowedOpenIds: 'ou_allowed' });
  assert.match(await authorized.findCustomer({ email: 'a@example.com' }, { ...allowed, chatType: 'group' }), /单聊/);
  assert.match(await authorized.findCustomer({ email: 'a@example.com' }, { ...allowed, senderOpenId: 'ou_other' }), /未获CRM/);
  assert.equal(m.calls.length, 0);
});

test('customer query is exact-match and preserves unknown CRM values', async () => {
  const m = mock([row({ 邮箱: 'a@example.com', 客户姓名: 'A', 历史订单数: 3 })]);
  const crm = createCrmReadonly(m.client, { allowedOpenIds: 'ou_allowed' });
  const answer = await crm.findCustomer({ email: 'A@EXAMPLE.COM' }, allowed);
  assert.match(answer, /尚未完成计算/);
  assert.match(answer, /近180天是否复购.*待计算/);
  assert.match(answer, /历史是否复购.*是/);
  assert.deepEqual(m.calls[0].data.filter.conditions, [{ field_name: '邮箱', operator: 'is', value: ['a@example.com'] }]);
  assert.equal(m.calls[0].path.table_id, 'tblbk7Ju6fcM1BXF');
});

test('name ambiguity never silently returns the first customer', async () => {
  const m = mock([row({ 客户姓名: 'Alice 1' }), row({ 客户姓名: 'Alice 2' })]);
  const crm = createCrmReadonly(m.client, { allowedOpenIds: 'ou_allowed' });
  assert.match(await crm.findCustomer({ name: 'Alice' }, allowed), /同名或重复匹配/);
});

test('segment list filters verified customers and reports page limits honestly', async () => {
  const m = mock([row({ 客户姓名: 'A', CRM等级: 'S+' })], 21);
  const crm = createCrmReadonly(m.client, { allowedOpenIds: 'ou_allowed' });
  const answer = await crm.listSegment({ crm_grade: 'S+', limit: 40 }, allowed);
  assert.match(answer, /匹配总数：21/);
  assert.match(answer, /仅展示 1 条/);
  assert.equal(m.calls[0].params.page_size, 20);
  assert.deepEqual(m.calls[0].data.filter.conditions, [
    { field_name: '客户数据状态', operator: 'is', value: ['有效'] },
    { field_name: 'CRM等级', operator: 'is', value: ['S+'] },
  ]);
  assert.match(await crm.listSegment({ crm_grade: 'S+', rfm_group: '重要价值用户' }, allowed), /只查询其中一种/);
});

test('communication query reads the communication table, not the customer master', async () => {
  const m = mock([row({ 客户邮箱: 'a@example.com', 邮件主题: 'Delivery', 任务状态: '处理中' })]);
  const crm = createCrmReadonly(m.client, { allowedOpenIds: 'ou_allowed' });
  const answer = await crm.customerCommunications({ email: 'a@example.com' }, allowed);
  assert.match(answer, /Delivery/);
  assert.equal(m.calls[0].path.table_id, 'tblNi7C5q5FYlG06');
});

test('projection never infers grade from historical spend', () => {
  const p = customerProjection({ 历史累计消费: 10000, 历史订单数: 9, 近180天有效订单数: 1 });
  assert.equal(p.CRM等级, '尚未完成计算');
  assert.equal(p['近180天是否复购'], '否');
  assert.equal(p['历史是否复购'], '是');
});

test('Feishu permission error is surfaced without falling back to Shopify', async () => {
  const client = { bitable: { appTableRecord: { search: async () => ({ code: 91403, msg: 'Forbidden' }) } } };
  const crm = createCrmReadonly(client, { allowedOpenIds: 'ou_allowed' });
  assert.match(await crm.findCustomer({ email: 'a@example.com' }, allowed), /91403/);
});
