// --------------------------------------------------------------------------
// Query sanitization helpers for user-supplied objects.
//
// User-controlled values must never be allowed to carry MongoDB query
// operators ($gt, $ne, $regex, $exists, $where, ...) into find()/update()
// selectors. `stripOperators` recursively removes any $-prefixed keys so a
// client cannot turn a scalar field match into an operator expression.
// --------------------------------------------------------------------------

export function stripOperators(value) {
  if (Array.isArray(value)) {
    return value.map(stripOperators);
  }
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out = {};
    for (const key of Object.keys(value)) {
      if (key.charAt(0) === '$') {
        continue;
      }
      out[key] = stripOperators(value[key]);
    }
    return out;
  }
  return value;
}

// Operators that execute server-side JavaScript / arbitrary expressions.
// These are never legitimately needed from a client query and enable
// server-side code execution or ReDoS/DoS, so strip them even from methods
// that intentionally accept query operators (e.g. RiskProperties.Filter).
const DANGEROUS_OPERATORS = new Set([
  '$where',
  '$function',
  '$accumulator',
  '$expr',
  '$jsonSchema'
]);

export function stripDangerousOperators(value) {
  if (Array.isArray(value)) {
    return value.map(stripDangerousOperators);
  }
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out = {};
    for (const key of Object.keys(value)) {
      if (DANGEROUS_OPERATORS.has(key)) {
        continue;
      }
      out[key] = stripDangerousOperators(value[key]);
    }
    return out;
  }
  return value;
}

// Convenience guard for fields used directly in a selector: only accept a
// plain string, otherwise return undefined so the caller can reject it.
export function asString(value) {
  return typeof value === 'string' ? value : undefined;
}

export default stripOperators;
