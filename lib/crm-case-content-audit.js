"use strict";
// Privacy-preserving, bounded Case content audit. This is strictly read-only:
// no Feishu calls, no cursor/checkpoint persistence, no raw IDs in output.
const crypto = require("node:crypto");
const PREFIX = "crm-cases/v1/events/";
const MAX_CURSOR_BYTES = 1024;
function validCursor(value) {
  return typeof value === "string" && Buffer.byteLength(value, "utf8") <= MAX_CURSOR_BYTES &&
    value.length > 0 && !/[\x00-\x1f\x7f]/.test(value);
}
async function auditCaseContentPage({ listPage, readRecord, cursor, pageSize = 100,
  prefix = PREFIX } = {}) {
  if (typeof listPage !== "function" || typeof readRecord !== "function") {
    throw Error("Case content audit dependencies unavailable");
  }
  if (prefix !== PREFIX || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 250 ||
      (cursor !== undefined && !validCursor(cursor))) {
    throw Error("Case content audit bounds invalid");
  }
  const page = await listPage({prefix, access:"private", limit:pageSize, cursor});
  if (!page || !Array.isArray(page.blobs) || typeof page.hasMore !== "boolean" ||
      page.blobs.length > pageSize || (page.hasMore && page.blobs.length === 0) ||
      (page.hasMore && (!validCursor(page.cursor) || page.cursor === cursor))) {
    throw Error("Case content audit listing incomplete");
  }
  const paths = new Set();
  const eventIds = new Set();
  const digest = crypto.createHash("sha256");
  let legacyWithoutEventId = 0;
  for (const item of page.blobs) {
    const path = item?.pathname;
    if (typeof path !== "string" || !path.startsWith(prefix) || path.length <= prefix.length || paths.has(path)) {
      throw Error("Case content audit archive path invalid");
    }
    paths.add(path);
  }
  // Keep bounded I/O and memory; never echo a path, message, or customer ID.
  const items = [...paths];
  for (let i = 0; i < items.length; i += 10) {
    const batch = await Promise.all(items.slice(i, i+10).map(path => readRecord(path)));
    for (let j = 0; j < batch.length; j++) {
      const record = batch[j];
      if (!record || typeof record !== "object" || Array.isArray(record)) {
        throw Error("Case content audit event unreadable");
      }
      const id = record.eventId;
      if (id == null || id === "") {
        legacyWithoutEventId++;
      } else if (typeof id !== "string" || eventIds.has(id)) {
        throw Error("Case content audit event ID malformed or repeated");
      } else {
        eventIds.add(id);
      }
      const path = items[i+j];
      digest.update(JSON.stringify([path, id ?? null]) + "\n");
    }
  }
  return {
    inspectedObjects: items.length,
    legacyWithoutEventId,
    pageFingerprint: digest.digest("hex"),
    hasMore: page.hasMore,
    // Cursor is opaque and can only be used through the authenticated audit API.
    nextCursor: page.hasMore ? page.cursor : null,
    pageContentReadable: true,
    // Page checks cannot prove cross-page deduplication or full Feishu coverage.
    fullArchiveContentVerified: false,
    crossPageDuplicateVerified: false,
    feishuCoverageVerified: false,
    checkpointAdvanced: false,
  };
}
module.exports = {auditCaseContentPage};
