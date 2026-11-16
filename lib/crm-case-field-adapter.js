"use strict";
// Feishu Bitable: type 3 = single select, type 4 = multi select.
// Convert only fields whose actual schema requires conversion.
function adaptFields(fields, schema) {
  if (!Array.isArray(schema) || !schema.length) throw Error("Feishu field schema unavailable");
  const byName = new Map(schema.map(f => [f.field_name, Number(f.type)]));
  const out = {};
  for (const [name, value] of Object.entries(fields)) {
    if (!byName.has(name)) throw Error("Feishu field schema missing: " + name);
    const type = byName.get(name);
    if (type === 4) {
      if (value == null || value === "") continue;
      const choices = Array.isArray(value) ? value : [value];
      if (!choices.every(x => typeof x === "string" && x.trim())) {
        throw Error("Invalid multi-select value for: " + name);
      }
      out[name] = [...new Set(choices.map(x => x.trim()))];
    } else if (type === 3) {
      if (Array.isArray(value)) {
        if (value.length !== 1 || typeof value[0] !== "string") throw Error("Invalid single-select value for: " + name);
        out[name] = value[0];
      } else {
        out[name] = value;
      }
    } else {
      out[name] = value;
    }
  }
  return out;
}
module.exports = { adaptFields };
