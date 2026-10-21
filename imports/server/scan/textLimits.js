// One cap for every piece of caller-supplied text the scan path stores or echoes back.
//
// Two sinks share the same hole. `skippedDependencies` copies a node's name/key/purl onto
// the scan document, and `Meteor.publish('scanDetail')` hands that document to the tenant's
// users; the 400 the depth guard returns repeats the offending identifier three times
// (`object`, `description`, `messages[0].message`). Neither field has an upper bound in
// ApiDependencySchema - `name` declares a `min` and no `max` - so a 2 MB name was stored
// whole and answered with a response several times its own size.
//
// 256 characters is far more than any package name, key or purl needs and still leaves the
// value recognisable in the scan view and in the error message.
//
// Meteor-free CommonJS, same as its callers ./dependencyDepth.js and
// ./skippedDependencies.js, so plain Jest can require it (`yarn meteor-test` does not boot
// on this checkout).

/** The longest caller-supplied string this path will store or send back. */
const MAX_ECHOED_TEXT = 256;

const ELLIPSIS = '...';

/**
 * Cap a caller-supplied string. The result is never longer than `max`, so a caller can
 * budget a response from the number of values it interpolates.
 *
 * @param {*} value anything; a non-string is returned untouched, because the callers use
 *   this on optional fields and must not turn a missing value into "undefined"
 * @param {Number} [max] the cap, defaults to MAX_ECHOED_TEXT
 * @returns {*} the value, truncated when it is a string longer than the cap
 */
function truncateText(value, max) {
  if (typeof value !== 'string') return value;
  const limit = typeof max === 'number' && max > 0 ? max : MAX_ECHOED_TEXT;
  if (value.length <= limit) return value;
  if (limit <= ELLIPSIS.length) return value.slice(0, limit);
  return value.slice(0, limit - ELLIPSIS.length) + ELLIPSIS;
}

/**
 * A short, stable label for a failure, safe to persist where the tenant's users read it.
 *
 * Raw driver text is the thing being kept out: an E11000 quotes the conflicting document,
 * and a Meteor.Error's `reason` is written for an operator, not for a scan report. The
 * class and the code identify the failure well enough to group and search on; the full
 * text stays on the server log, which is where handleDependency already writes it.
 *
 * @param {*} error whatever was thrown
 * @returns {String|undefined} e.g. "MongoServerError 11000", or undefined for no error
 */
function summariseError(error) {
  if (!error) return undefined;
  if (typeof error !== 'object') return 'error';
  const name = typeof error.name === 'string' && error.name ? error.name : 'Error';
  // Meteor.Error carries the code on `error`, Mongo and Node errors on `code`. Both are
  // developer- or driver-assigned constants, never a value copied out of the payload.
  const code = error.error !== undefined ? error.error : error.code;
  if (typeof code === 'number' || (typeof code === 'string' && code)) {
    return truncateText(name + ' ' + code);
  }
  return truncateText(name);
}

module.exports = {
  MAX_ECHOED_TEXT,
  truncateText,
  summariseError
};
