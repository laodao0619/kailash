"use strict";

// This checks whether the latest automated production QA covers the *current*
// private customer index snapshot. It is not an employee/business UAT signoff.
const REQUIRED_CHECKS = Object.freeze([
  "list", "sort", "tier", "search", "customer360", "productHistory",
  "mailSummary", "noteRead", "rfmSummary", "catalog", "caseCenter", "rfmEight",
]);

function qaCoverage(snapshot, qa) {
  const blocked = reason => ({ freshForSnapshot: false, reason });
  if (!snapshot || snapshot.version !== 2) return blocked("snapshot_unavailable");
  if (!qa || qa.ready !== true) return blocked("qa_unavailable_or_failed");
  if (!qa.checks || REQUIRED_CHECKS.some(name => qa.checks[name] !== true)) {
    return blocked("qa_checks_incomplete");
  }
  if (!Number.isSafeInteger(snapshot.total) || snapshot.total < 0 ||
      !Number.isSafeInteger(qa.metrics?.total) || qa.metrics.total !== snapshot.total) {
    return blocked("qa_snapshot_count_mismatch");
  }
  const snapshotTime = Date.parse(snapshot.generatedAt || "");
  const qaTime = Date.parse(qa.at || "");
  if (!Number.isFinite(snapshotTime) || !Number.isFinite(qaTime)) {
    return blocked("qa_timestamp_invalid");
  }
  if (qaTime < snapshotTime) return blocked("qa_predates_snapshot");
  return { freshForSnapshot: true, reason: "qa_covers_current_snapshot" };
}

module.exports = { qaCoverage, REQUIRED_CHECKS };
