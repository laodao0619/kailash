'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { isBotMentioned } = require('./message-gating');

const bot = 'ou_bot_123';

test('allows a group reply only when the bot itself is mentioned', () => {
  assert.equal(isBotMentioned([{ id: { open_id: bot }, key: '@_user_1' }], bot), true);
});

test('does not reply when a colleague, but not the bot, is mentioned', () => {
  assert.equal(isBotMentioned([{ id: { open_id: 'ou_colleague' }, key: '@_user_1' }], bot), false);
});

test('fails closed when mention metadata or bot identity is unavailable', () => {
  assert.equal(isBotMentioned([], bot), false);
  assert.equal(isBotMentioned([{ id: { open_id: bot } }], null), false);
  assert.equal(isBotMentioned([{ id: { user_id: 'u_bot' } }], bot), false);
  assert.equal(isBotMentioned(null, bot), false);
});
