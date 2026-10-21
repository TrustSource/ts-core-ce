// --------------------------------------------------------------------------
// Modifier sanitization for user-supplied update modifiers.
//
// Server-side update methods pass a client-controlled `modifier` straight to
// `updateAsync(query, modifier)`. Even when the query is forced to the caller's
// own `companyId`, the modifier itself can still:
//   * re-tenant the matched document      ($set: {companyId: 'OTHER'})
//   * forge/move identity fields           ($set/$rename of _id, companyId)
//   * pollute the prototype chain          ($set: {__proto__: {...}})
//   * execute server-side JavaScript        ($where/$function inside a payload)
//
// `sanitizeModifier` strips protected/tenant fields and prototype-pollution keys
// from every operator payload, drops $rename pairs touching a protected field,
// and removes the dangerous JS operators. All other fields are preserved so the
// legitimate update still applies.
//
// Pure (no Meteor import) so it can be unit-tested standalone, matching
// `sanitizeQuery.js`. Non-mutating: returns a cleaned copy.
// --------------------------------------------------------------------------

import {stripDangerousOperators} from './sanitizeQuery';

const PROTO_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

// Fields a client must never be able to set/rename via an update modifier.
export const DEFAULT_PROTECTED_FIELDS = ['companyId', '_id'];

// The top-level segment of a (possibly dotted/positional) field path.
function topSegment(path) {
  return typeof path === 'string' ? path.split('.')[0] : path;
}

function isBlockedField(field, protectedFields) {
  const top = topSegment(field);
  return PROTO_KEYS.has(top) || protectedFields.has(top);
}

export function sanitizeModifier(modifier, options = {}) {
  if (!modifier || typeof modifier !== 'object' || Array.isArray(modifier)) {
    return modifier;
  }
  const protectedFields = new Set(options.protectedFields || DEFAULT_PROTECTED_FIELDS);

  // Remove $where/$function/... anywhere in the modifier first.
  const cleaned = stripDangerousOperators(modifier);

  const out = {};
  for (const op of Object.keys(cleaned)) {
    if (PROTO_KEYS.has(op)) {
      continue;
    }
    const payload = cleaned[op];

    // Only operator payloads are field-maps. Bare (non-$) keys are left as-is
    // for MongoDB to reject (operator/replacement mix), which is the existing
    // contract of these update methods.
    if (op.charAt(0) !== '$' || !payload || typeof payload !== 'object' || Array.isArray(payload)) {
      out[op] = payload;
      continue;
    }

    const isRename = op === '$rename';
    const cleanedPayload = {};
    for (const field of Object.keys(payload)) {
      if (isBlockedField(field, protectedFields)) {
        continue;
      }
      // $rename values are destination field names - block protected targets too.
      if (isRename && isBlockedField(payload[field], protectedFields)) {
        continue;
      }
      cleanedPayload[field] = payload[field];
    }
    out[op] = cleanedPayload;
  }
  return out;
}

export default sanitizeModifier;
