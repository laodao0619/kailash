"use strict";

// The one-off Gmail historical import finished in production. Never let an
// accidentally invoked legacy endpoint restart from a missing/damaged cursor.
// Re-enabling is an explicit administrative change, NOT a scheduled fallback.
function historicalImportEnabled(env = process.env) {
  return env?.CRM_GMAIL_HISTORICAL_IMPORT_ENABLED === "true";
}

module.exports = { historicalImportEnabled };
