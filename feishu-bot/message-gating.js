'use strict';

// Feishu message mentions contain an id object. Only an exact open_id match
// to the bot itself is allowed to trigger a group reply.
function isBotMentioned(mentions, botOpenId) {
  if (!botOpenId || !Array.isArray(mentions)) return false;
  return mentions.some((mention) => mention?.id?.open_id === botOpenId);
}

module.exports = { isBotMentioned };
