'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { markdownToPost } = require('./message-format');

test('heading-only answers have a valid post body', () => {
  const post = markdownToPost('# 查询已完成');
  assert.equal(post.zh_cn.title, '查询已完成');
  assert.deepEqual(post.zh_cn.content, [[{ tag: 'text', text: '查询已完成' }]]);
});

test('empty answers are still valid post content', () => {
  const post = markdownToPost('  \n');
  assert.ok(post.zh_cn.content[0][0].text);
});

test('preserves lists and bold formatting', () => {
  const post = markdownToPost('# 今日经营\n- **订单** 20\n1. 核实退款');
  assert.equal(post.zh_cn.title, '今日经营');
  assert.deepEqual(post.zh_cn.content[0][1], { tag: 'text', text: '订单', style: ['bold'] });
  assert.equal(post.zh_cn.content[1][0].text, '1. ');
});
