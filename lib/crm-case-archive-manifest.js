"use strict";
// Private Blob metadata-only audit. This never downloads message bodies,
// changes checkpoints, calls Feishu, or exposes any event/customer identity.
const crypto = require("node:crypto");
const DEFAULT_PREFIX = "crm-cases/v1/events/";
async function auditCaseArchive({ listPage, prefix = DEFAULT_PREFIX, pageSize = 500,
  maxPages = 50 } = {}) {
  if (typeof listPage !== "function") throw Error("Case manifest listing unavailable");
  if (prefix !== DEFAULT_PREFIX || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 1000 ||
      !Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 50) {
    throw Error("Case manifest bounds invalid");
  }
  const hash = crypto.createHash("sha256");
  const seenPaths = new Set(), seenCursors = new Set();
  let cursor, pages = 0;
  for (let i = 0; i < maxPages; i++) {
    const page = await listPage({ prefix, access: "private", limit: pageSize, cursor });
    if (!page || !Array.isArray(page.blobs) || typeof page.hasMore !== "boolean" ||
        page.blobs.length > pageSize || (page.hasMore && page.blobs.length === 0)) {
      throw Error("Case manifest listing incomplete");
    }
    for (const blob of page.blobs) {
      const path = blob?.pathname;
      if (typeof path !== "string" || !path.startsWith(prefix) || path.length <= prefix.length ||
          seenPaths.has(path)) throw Error("Case manifest path invalid or repeated");
      seenPaths.add(path);
      hash.update(path.length + ":" + path + "\n");
    }
    pages++;
    if (!page.hasMore) return {
      pageCount: pages, eventObjectCount: seenPaths.size,
      listingFingerprint: hash.digest("hex"), fullArchiveListingVerified: true,
      // Full *listing* is NOT evidence that content is readable or Cases are reconciled.
      eventContentVerified: false, feishuCoverageVerified: false,
    };
    if (typeof page.cursor !== "string" || !page.cursor.trim() || seenCursors.has(page.cursor)) {
      throw Error("Case manifest pagination invalid");
    }
    seenCursors.add(page.cursor);
    cursor = page.cursor;
  }
  throw Error("Case manifest pagination exceeds safety limit");
}
module.exports = {auditCaseArchive};
