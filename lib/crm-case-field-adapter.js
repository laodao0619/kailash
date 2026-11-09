"use strict";
// Feishu Bitable: type 3 = single select, type 4 = multi select.
// Convert only fields whose actual schema requires conversion.
function adaptFields(fields, schema) {
  if (!Array.isArray(schema) || !schema.length) throw Error("Feishu field schema unavailable");
  const byName = new Map(schema.map(f => [f.field_name, f]));
  const out = {};
  for (const [name, value] of Object.entries(fields)) {
    if (!byName.has(name)) throw Error("Feishu field schema missing: " + name);
    const field = byName.get(name);
    const type = Number(field.type);
    const options = field.property?.options;
    const allowed = Array.isArray(options) ? new Set(options.map(x => x.name).filter(x => typeof x === "string")) : null;
    const checkOptions = values => {
      if (allowed && values.some(x => !allowed.has(x))) throw Error("Feishu select option not configured for: " + name);
    };
    if (type === 4) {
      if (value == null || value === "") continue;
      const choices = Array.isArray(value) ? value : [value];
      if (!choices.every(x => typeof x === "string" && x.trim())) {
        throw Error("Invalid multi-select value for: " + name);
      }
      const normalized = [...new Set(choices.map(x => x.trim()))];
      checkOptions(normalized);
      out[name] = normalized;
    } else if (type === 3) {
      if (Array.isArray(value)) {
        if (value.length !== 1 || typeof value[0] !== "string") throw Error("Invalid single-select value for: " + name);
        checkOptions(value);
        out[name] = value[0];
      } else {
        if (typeof value === "string" && value) checkOptions([value]);
        out[name] = value;
      }
    } else {
      out[name] = value;
    }
  }
  return out;
}
module.exports = { adaptFields };
