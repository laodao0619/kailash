"use strict";
// Feishu Bitable: type 3 = single select, type 4 = multi select.
// Convert only fields whose actual schema requires conversion.
function adaptFields(fields, schema) {
  if (!Array.isArray(schema) || !schema.length) throw Error("Feishu field schema unavailable");
  // Duplicate or malformed field definitions can silently select a wrong type.
  // Refuse the entire write instead of coercing values against ambiguous schema.
  const byName = new Map();
  for (const field of schema) {
    if (!field || typeof field.field_name !== "string" || !field.field_name.trim()) {
      throw Error("Feishu field schema has missing field name");
    }
    if (byName.has(field.field_name)) {
      throw Error("Feishu field schema has duplicate field name: " + field.field_name);
    }
    if (!Number.isInteger(Number(field.type)) || Number(field.type) < 1) {
      throw Error("Feishu field schema has invalid type: " + field.field_name);
    }
    byName.set(field.field_name, field);
  }
  const out = {};
  for (const [name, value] of Object.entries(fields)) {
    if (!byName.has(name)) throw Error("Feishu field schema missing: " + name);
    const field = byName.get(name);
    const type = Number(field.type);
    const options = field.property?.options;
    if ((type === 3 || type === 4) && !Array.isArray(options)) throw Error("Feishu select options unavailable for: " + name);
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
