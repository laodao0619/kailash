"use strict";
/**
 * Bound independent read-only lookups so a slow Feishu record lookup does not
 * serialize an entire 30-customer Shopify delta page.
 *
 * This helper is intentionally all-or-nothing: callers must not write or
 * advance a checkpoint until every lookup for the page succeeds.
 */
async function mapBounded(items, limit, visit) {
  if (!Array.isArray(items) || !Number.isInteger(limit) || limit < 1 ||
      typeof visit !== "function") throw Error("Invalid bounded lookup configuration");
  const results = new Array(items.length);
  let next = 0;
  let failure = null;
  async function worker() {
    while (failure === null) {
      const index = next++;
      if (index >= items.length) return;
      try {
        results[index] = await visit(items[index], index);
      } catch (error) {
        failure ??= error;
        return;
      }
    }
  }
  await Promise.all(Array.from({length:Math.min(limit,items.length)},worker));
  if (failure !== null) throw failure;
  return results;
}
module.exports = { mapBounded };
