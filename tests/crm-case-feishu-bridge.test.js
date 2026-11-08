"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createGmailBridge } = require('../feishu-bot/gmail-bridge');

test('authorized Feishu case query uses signed endpoint and shows source plus resolution caveat', async () => {
  const previous = global.fetch;
  let seen = false;
  global.fetch = async (url, options) => {
    assert.equal(new URL(url).pathname, '/api/crm-cases');
    const timestamp = options.headers['x-kailash-timestamp'];
    const expected = 'sha256=' + crypto.createHmac('sha256','secret')
      .update(`${timestamp}\n/api/crm-cases\n10`).digest('hex');
    assert.equal(options.headers['x-kailash-signature'], expected);
    seen = true;
    return { ok:true, json:async()=>({ok:true, scannedEvents:2, caseCountWithinScan:1, cases:[{
      caseId:'CASE-ABC',orderNumber:'7159',priority:'P0',category:'未收到货',messageCount:2,
      crmVerified:true,crmGrade:'B',customerName:'Corinne Martin',customerEmail:'arcopat@orange.fr',
      receivedAt:'2026-11-08T08:00:00Z',subject:'Order 7159',summary:'包裹未收到',replyStatus:'客服已回复（未确认解决）',
      originalExcerpt:'Did not receive my order',emails:['arcopat@orange.fr','corinne.martin4@orange.fr'],
    }]})};
  };
  try {
    const bridge = createGmailBridge({secret:'secret',allowedOpenIds:'user1'});
    const result = await bridge.pendingCustomerEmails({limit:10},{chatType:'p2p',senderOpenId:'user1'});
    assert.equal(seen,true);
    assert.match(result,/CASE-ABC/);
    assert.match(result,/corinne\.martin4@orange\.fr/);
    assert.match(result,/已回复不等于问题已解决/);
  } finally { global.fetch = previous; }
});

test('unauthorized Feishu chat never calls backend', async () => {
  const original = global.fetch;
  global.fetch = async () => { throw Error('unexpected fetch'); };
  try {
    const bridge = createGmailBridge({secret:'secret',allowedOpenIds:'user1'});
    const result = await bridge.pendingCustomerEmails({}, {chatType:'group',senderOpenId:'user1'});
    assert.match(result,/授权单聊/);
  } finally { global.fetch = original; }
});
