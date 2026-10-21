// ---------------------------------------------------------------------------
// The CSAF.EncodeModuleIds / CSAF.DecodeProductIds handlers, as pure functions.
//
// No Meteor import, so Jest can drive them directly; imports/startup/server/csaf.js
// binds the real codec, the real ownership lookup and a real Meteor.Error factory.
//
// `deps.error` is injected rather than built here for a concrete reason: a plain
// Error thrown out of a Meteor method surfaces to the DDP client as a bare 500,
// which would collapse every 400/403 in the method contract into one code.
//
// Tenant scoping is what stops these being a general-purpose oracle:
//   encode - ALL-OR-NOTHING. Any id the caller's company does not own (including
//            one that exists nowhere, so the method is not an existence oracle)
//            rejects the whole batch with 403 and mints nothing.
//   decode - PER-TOKEN. A stale, foreign or undecodable token in an old document
//            is a normal state, so it reports null for that key and carries on.
//
// KNOWN LIMITATION of keying both responses by a caller-supplied string. An own
// `__proto__` key does survive DDP on the EJSON this app pins (ejson@1.2.0:
// stringifyDDP/parseDDP are copy-on-write and never rebuild the object, and
// EJSON.clone - which does drop such a key - is applied to method ARGS only, not
// to the result), and Object.fromEntries below keeps it an own key rather than a
// prototype write. But that is a property of one EJSON version: 1.1.x routed
// fromJSONValue through clone and DID drop it, and _adjustTypesFromJSONValue
// still performs a bare `obj[key] = ...` assignment for any value that needs
// converting, which for a `__proto__` key would be a prototype write rather than
// a data write - unreachable here only because these values are strings and null.
// Keying the responses by request INDEX instead (a parallel array, or an array of
// {id, token} pairs) would remove the class outright. That is an Interface
// Contract change requiring the matching client work, so it is a follow-up rather
// than something to change under the client that is already built against this
// shape. The decode direction is immune either way: a prototype-key string
// carries neither the `v2:` prefix nor the OpenSSL header, so it can never decode
// and its value is always null - indistinguishable from an absent key.
// ---------------------------------------------------------------------------

// Declared once, and interpolated into the error messages, so the number the
// client is told and the number enforced cannot drift apart.
const CSAF_ID_BATCH_MAX = 1000;

// The longest single element a caller may send. The batch cap above bounds how
// MANY values arrive; without this one, each of those 1000 values could be
// arbitrarily long and every one of them would be run through a cipher whole.
//
// Value-equal to MAX_TOKEN_LENGTH in ./productIdCodec.js, and asserted equal by
// test_api/specs/csaf-product-id.unit.spec.js. Declared rather than imported so
// these handlers stay dependency-free pure functions (the property that lets Jest
// drive them directly); the test is what stops the two drifting apart.
const CSAF_ID_MAX_LENGTH = 512;

/**
 * Validate and dedupe a batch of ids/tokens.
 * @returns {string[]|null} the deduped values, or null when the input is not an
 *          array of non-empty strings within the length bound.
 */
function normalizeIdBatch(values) {
  if (!Array.isArray(values)) {
    return null;
  }
  const seen = new Set();
  for (const value of values) {
    if (typeof value !== 'string' || value === '' || value.length > CSAF_ID_MAX_LENGTH) {
      return null;
    }
    seen.add(value);
  }
  return [...seen];
}

// The cap is checked on the RAW array, before dedupe, so a caller cannot get an
// unbounded batch past it by repeating one id.
function assertBatch(deps, values, invalidReason, oversizeReason) {
  if (!Array.isArray(values)) {
    throw deps.error(400, invalidReason);
  }
  if (values.length > CSAF_ID_BATCH_MAX) {
    throw deps.error(400, oversizeReason);
  }
  const normalized = normalizeIdBatch(values);
  if (!normalized) {
    throw deps.error(400, invalidReason);
  }
  return normalized;
}

/**
 * ids -> {[id]: token}, one key per distinct id.
 * @param deps {{encodeIdMap, filterOwnedIds, error}}
 */
async function encodeModuleIds(deps, rawIds, companyId) {
  const ids = assertBatch(deps, rawIds, 'Invalid ids', `Too many ids (max ${CSAF_ID_BATCH_MAX})`);
  if (!companyId) {
    throw deps.error(403, 'Access Denied');
  }
  if (!ids.length) {
    return {};
  }
  const owned = await deps.filterOwnedIds(ids, companyId);
  if (ids.some((id) => !owned.has(id))) {
    throw deps.error(403, 'Access Denied');
  }
  try {
    return deps.encodeIdMap(ids);
  } catch (error) {
    // Reached only when crypto.js's encrypt() swallowed its own failure and
    // returned undefined. The client is told nothing beyond "it failed", but the
    // one moment at-rest encryption is broken must not be silent server-side.
    console.error('[CSAF productId] encode failed:', error && error.message);
    throw deps.error(500, 'Could not encode product ids');
  }
}

/**
 * tokens -> {[token]: id|null}, one key per distinct token. The value is the
 * decoded id ONLY when it belongs to a module or product of the caller's company.
 * @param deps {{decodeProductId, filterOwnedIds, error}}
 */
async function decodeProductIds(deps, rawTokens, companyId) {
  const tokens = assertBatch(deps, rawTokens, 'Invalid tokens', `Too many tokens (max ${CSAF_ID_BATCH_MAX})`);
  if (!companyId) {
    throw deps.error(403, 'Access Denied');
  }
  if (!tokens.length) {
    return {};
  }
  const decoded = new Map();
  tokens.forEach((token) => {
    const id = deps.decodeProductId(token);
    decoded.set(token, typeof id === 'string' && id !== '' ? id : undefined);
  });
  const candidates = [...new Set([...decoded.values()].filter((id) => id !== undefined))];
  const owned = candidates.length ? await deps.filterOwnedIds(candidates, companyId) : new Set();
  // Object.fromEntries, not `result[token] = ...`: a product_id comes out of an
  // UPLOADED document, so a token may be any string - and a plain assignment of
  // `__proto__` sets the prototype instead of creating an own key, silently
  // dropping that entry from the response.
  return Object.fromEntries(tokens.map((token) => {
    const id = decoded.get(token);
    return [token, id !== undefined && owned.has(id) ? id : null];
  }));
}

module.exports = {
  CSAF_ID_BATCH_MAX,
  CSAF_ID_MAX_LENGTH,
  normalizeIdBatch,
  encodeModuleIds,
  decodeProductIds
};
