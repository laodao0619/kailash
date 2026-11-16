"use strict";
// QA results are reusable only for the SAME completed private index build.
// A newly published index invalidates a 4-hour cached QA result immediately.
// This is a pure safety gate: no customer data, credentials, network or writes.
const MAX_QA_AGE_MS = 4 * 60 * 60 * 1000;
function canReuseQa(previous, buildState, now=Date.now(), runtimeDeployment="") {
  if (!previous || previous.version !== 5 || previous.ready !== true) return false;
  // New Vercel deployments must not inherit QA success from an earlier build,
  // even when both deployments read the same private customer index.
  if (typeof runtimeDeployment !== "string" || !runtimeDeployment ||
      previous.deploymentId !== runtimeDeployment) return false;
  if (!buildState || buildState.complete !== true || typeof buildState.slot !== "string" || !buildState.slot) return false;
  const qaAt = Date.parse(previous.at || "");
  const buildCompletedAt = Date.parse(buildState.completedAt || "");
  if (!Number.isFinite(qaAt) || !Number.isFinite(buildCompletedAt) || !Number.isFinite(now)) return false;
  if (now < qaAt || now - qaAt >= MAX_QA_AGE_MS) return false;
  // This also protects against an index refresh racing the previous QA run.
  return qaAt >= buildCompletedAt;
}
module.exports = {canReuseQa, MAX_QA_AGE_MS};
