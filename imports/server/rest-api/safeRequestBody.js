// A merge-safe copy of a REST request body.
//
// Every mutating endpoint in this directory copies the parsed body into a fresh
// object, drops the keys MongoDB would read as operators, and merges the result
// onto the stored document. That copy is where two different things go wrong,
// and both of them are silent.
//
// 1. `bodyParser.json` is plain `JSON.parse` with no reviver, and JSON.parse DOES
//    create an own enumerable `__proto__` key. A plain `out[key] = value` on that
//    key does not store anything: it fires Object.prototype's `__proto__` SETTER
//    and reassigns the copy's prototype. Everything the attacker put under it
//    becomes INHERITED on the copy, so every `hasOwnProperty` guard downstream
//    answers false...
// 2. ...while `_.extend` is `createAssigner(_.allKeys)` and `_.allKeys` is a
//    `for...in`, so it copies inherited enumerable keys and lifts the payload
//    back onto the target as an own property.
//
// Together those two facts turn `{"__proto__": {"componentConfig": ...}}` into a
// body that skips every own-key check on the way in and is written anyway. That
// is how the round-1 strip of the manual-license-resolution audit trail
// (resolutionEntry.stripResolutionAudit) was bypassed with a 200 response and a
// forged "Set by Jane Doe, Head of Legal" record stored.
//
// SCOPE. This is the top level of the body, which is exactly the depth the
// `$`-operator strip it replaces already had - the point is that the object the
// handler then inspects and merges is an honest own-keys-only object, not that
// the payload is scrubbed recursively. Nested values are the business of the
// schema and of whatever strips them (see stripResolutionAudit, which uses the
// same defineProperty shape one level down).
//
// Plain CommonJS with no meteor/* import, like ../scan/rootDependency.js, so the
// behaviour is executable under Jest instead of merely asserted about: a source
// assertion that only pinned the call site is what let the bypass ship.

// Dropped outright rather than copied safely. `__proto__` is the exploitable
// one; `constructor` and `prototype` are refused with it because no module
// document has a field by either name, and a body that names one is not doing
// anything a legitimate client does.
const UNSAFE_BODY_KEYS = ['__proto__', 'constructor', 'prototype'];

const UNSAFE = new Set(UNSAFE_BODY_KEYS);

/**
 * A null-prototype copy of a request body carrying only the keys a handler may
 * merge: own, enumerable, not `$`-prefixed and not one of UNSAFE_BODY_KEYS.
 *
 * Null-prototype on purpose. It costs nothing, it makes every `hasOwnProperty`
 * check on the result trivially honest, and it means a key that slips past the
 * list can never reach an inherited setter.
 *
 * @param {*} body the parsed request body, whatever it turned out to be
 * @returns {Object} a copy with a null prototype; empty for anything that is not
 *   a plain object
 */
function safeRequestBody(body) {
  const safe = Object.create(null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return safe;
  }
  Object.keys(body).forEach(function (key) {
    if (key.startsWith('$') || UNSAFE.has(key)) {
      return;
    }
    safe[key] = body[key];
  });
  return safe;
}

module.exports = {UNSAFE_BODY_KEYS, safeRequestBody};
