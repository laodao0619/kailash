"use strict";
/** Read a private checkpoint without converting storage errors to empty state.
 * Missing files are expected before the first run; 403/5xx and corrupt JSON
 * must not be mistaken for a healthy, empty/finished CRM state.
 */
async function readCheckpoint(get, path, maxBytes = 4 * 1024 * 1024) {
  const response = await get(path, { access: "private" });
  if (!response || response.statusCode === 404) return null;
  if (response.statusCode !== 200 || !response.stream)
    throw Error("CRM private checkpoint read unavailable");
  const chunks = [];
  let bytes = 0;
  for await (const value of response.stream) {
    const part = Buffer.from(value);
    bytes += part.length;
    if (bytes > maxBytes) throw Error("CRM private checkpoint too large");
    chunks.push(part);
  }
  const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw Error("CRM private checkpoint malformed");
  return value;
}
module.exports = { readCheckpoint };
