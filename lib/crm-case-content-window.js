"use strict";
// Bounded multi-page private Case audit. No writes, no persisted cursors,
// no customer/event identity in output. This verifies a window only, never
// claims a consistent snapshot of the entire changing event archive.
const crypto = require("node:crypto");
const {auditCaseContentPage} = require("./crm-case-content-audit");

async function auditCaseContentWindow({listPage, readRecord, cursor,
  pageSize = 100, maxPages = 3} = {}) {
  if (typeof listPage !== "function" || typeof readRecord !== "function" ||
      !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100 ||
      !Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 3) {
    throw Error("Case content window bounds invalid");
  }
  const seenPaths = new Set(), seenIds = new Set(), seenCursors = new Set();
  const digest = crypto.createHash("sha256");
  let inspectedObjects = 0, legacyWithoutEventId = 0, inspectedPages = 0;
  let nextCursor = cursor;
  const readOnce = async path => {
    const record = await readRecord(path);
    const id = record?.eventId;
    if (typeof id === "string" && id.length) {
      if (seenIds.has(id)) throw Error("Case content window repeated event ID");
      seenIds.add(id);
    }
    return record;
  };
  const listOnce = async opts => {
    const page = await listPage(opts);
    if (Array.isArray(page?.blobs)) {
      for (const blob of page.blobs) {
        const path = blob?.pathname;
        if (typeof path === "string") {
          if (seenPaths.has(path)) throw Error("Case content window repeated archive path");
          seenPaths.add(path);
        }
      }
    }
    return page;
  };
  let hasMore = false;
  for (let i = 0; i < maxPages; i++) {
    const page = await auditCaseContentPage({
      listPage:listOnce, readRecord:readOnce, cursor:nextCursor, pageSize,
    });
    inspectedPages++;
    inspectedObjects += page.inspectedObjects;
    legacyWithoutEventId += page.legacyWithoutEventId;
    digest.update(page.inspectedObjects + ":" + page.pageFingerprint + "\n");
    hasMore = page.hasMore;
    nextCursor = page.nextCursor;
    if (!hasMore) break;
    if (seenCursors.has(nextCursor) || nextCursor === cursor) {
      throw Error("Case content window pagination cycle");
    }
    seenCursors.add(nextCursor);
  }
  return {
    inspectedPages, inspectedObjects, legacyWithoutEventId,
    windowFingerprint:digest.digest("hex"),
    hasMore, nextCursor,
    reachedListingEnd:!hasMore,
    // These assertions apply ONLY to pages read by this invocation.
    withinWindowDuplicateCheckPassed:true,
    contentReadableWithinWindow:true,
    fullArchiveContentVerified:false,
    sourceSnapshotConsistencyVerified:false,
    feishuCoverageVerified:false,
    checkpointAdvanced:false,
  };
}
module.exports = {auditCaseContentWindow};
