"use strict";
// A positional Case writeback checkpoint only belongs to the exact ordered
// archive window it was created from. New Gmail events can reorder cases,
// even when the same number of cases remains. Never skip a shifted Case.
const crypto = require("node:crypto");
const ID = /^CASE-[0-9A-F]{12}$/;
function archiveFingerprint(grouped) {
  if (!Array.isArray(grouped)) throw Error("Case grouped archive unavailable");
  const seen = new Set();
  const evidence = grouped.map(c => {
    if (!ID.test(c?.caseId || "") || seen.has(c.caseId)) {
      throw Error("Case grouped archive identity invalid");
    }
    seen.add(c.caseId);
    // Do not persist customer text, email, financial data or source Case
    // bodies. The digest detects reorder, new events and updated priorities.
    return [c.caseId, c.priority ?? null, c.receivedAt ?? null,
      c.messageCount ?? null, Array.isArray(c.eventIds) ? c.eventIds : null];
  });
  return crypto.createHash("sha256").update(JSON.stringify(evidence)).digest("hex");
}
function checkpointForArchive(state, grouped) {
  const fingerprint = archiveFingerprint(grouped);
  const offset = state?.offset === undefined ? 0 : state.offset;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > grouped.length) {
    return {ok:false, blockedReason:"case_checkpoint_invalid"};
  }
  // Safe migration of legacy checkpoints: only offset zero may adopt a
  // fingerprint. A nonzero legacy position has no verifiable source ordering.
  if (offset > 0 && state?.sourceFingerprint !== fingerprint) {
    return {ok:false, blockedReason:"case_archive_window_changed"};
  }
  return {ok:true, offset, fingerprint};
}
module.exports = {archiveFingerprint, checkpointForArchive};
