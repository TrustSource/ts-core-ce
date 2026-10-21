// ---------------------------------------------------------------------------
// CSAF/VEX product_id codec - the pure core.
//
// A `product_id` in a generated CSAF/VEX document obfuscates an internal module
// (or product) `_id`. The codec lives under imports/server/, which Meteor never
// bundles to the browser.
//
// This file is deliberately dependency-free CommonJS: no Meteor, and no import of
// imports/lib/crypto.js (which uses Npm.require and cannot be loaded outside a
// Meteor process). `encrypt`/`decrypt`/`versionPrefix` are injected by the thin
// binding in ./productId.js, which keeps the behaviour here unit-testable under
// Jest - the same shape as imports/server/security/companySecretFields.js.
//
// Every token carries the crypto.js `v2:` prefix; anything else is not a token.
// ---------------------------------------------------------------------------

// The longest string that is worth handing to a cipher at all.
//
// A `v2:` token for a 17-character id is ~63 characters, so this is an order of
// magnitude above anything real. It exists because the input is request content:
// decodeProductId is driven in bulk by CSAF.DecodeProductIds and by remove.js over
// every product_id of an uploaded document, and neither csaf/create.js nor
// CSAFSchema caps that document's size, so an arbitrarily long "token" is pure
// attacker-chosen work. Screened here rather than only in the method validator,
// because remove.js does not go through that validator.
const MAX_TOKEN_LENGTH = 512;

function nonEmptyOrUndefined(value) {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/**
 * Build the codec around an injected crypto pair.
 *
 * @param {function(string): (string|undefined)} encrypt  crypto.js encrypt(); it
 *        swallows its own failures and returns undefined, which is why
 *        encodeProductId verifies the result rather than trusting it.
 * @param {function(string): (string|undefined)} decrypt  crypto.js decrypt();
 *        called ONLY for `v2:`-prefixed input (its no-prefix path is
 *        AES-256-CBC-hex for a different data set).
 * @param {string} versionPrefix  crypto.js VERSION_PREFIX. Injected, never
 *        re-declared, so the two copies cannot drift.
 */
function createProductIdCodec({encrypt, decrypt, versionPrefix} = {}) {
  if (typeof encrypt !== 'function' || typeof decrypt !== 'function'
    || typeof versionPrefix !== 'string' || versionPrefix === '') {
    throw new Error('CSAF productId: crypto is not wired');
  }

  /**
   * id -> `v2:<base64>`. Throws rather than returning anything unusable: a falsy
   * result would otherwise reach a document as `product_id: undefined`.
   */
  function encodeProductId(id) {
    if (typeof id !== 'string' || id === '') {
      throw new Error('CSAF productId: id must be a non-empty string');
    }
    const token = encrypt(id);
    if (typeof token !== 'string' || !token.startsWith(versionPrefix)) {
      throw new Error('CSAF productId: could not encrypt the identifier');
    }
    return token;
  }

  /**
   * token -> id, or undefined for anything undecodable. Never throws, never
   * returns an empty string: callers treat undefined as "not resolvable" and skip
   * the work, so a garbage value must not be mistaken for an id.
   */
  function decodeProductId(token) {
    if (typeof token !== 'string' || token === '' || token.length > MAX_TOKEN_LENGTH) {
      return undefined;
    }
    if (!token.startsWith(versionPrefix)) {
      return undefined;
    }
    return nonEmptyOrUndefined(decrypt(token));
  }

  /**
   * ids -> {[id]: token}. The single implementation of "ids to token map", shared
   * by the server generators and the CSAF.EncodeModuleIds method so the in-process
   * and DDP paths cannot produce different shapes. Throws on the first id that
   * cannot be encoded, rather than returning a map with a hole in it.
   *
   * Object.fromEntries, not `map[id] = ...`: an id reaching here is not always a
   * Mongo _id (the encode method takes ids from a DDP caller), and a plain
   * assignment of `__proto__` sets the prototype instead of creating an own key,
   * silently dropping that entry from the map.
   */
  function encodeIdMap(ids) {
    return Object.fromEntries((ids || []).map((id) => [id, encodeProductId(id)]));
  }

  return {encodeProductId, decodeProductId, encodeIdMap};
}

module.exports = {createProductIdCodec, MAX_TOKEN_LENGTH};
