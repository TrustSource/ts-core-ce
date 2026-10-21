// Request-body drain helper for RestApi.wrapAsync.
//
// CommonJS and dependency-free (no Meteor) so the Jest harness can require it
// without a running app - the same pattern as riskOrigin.js / feedAccess.js.
//
// Why this exists: the registered body parsers (router.js) handle only json and
// urlencoded; both skip `multipart/form-data`. A GET (or other bodyless method)
// that mistakenly arrives with a multipart body therefore leaves that body
// unread on the socket. Behind a reverse proxy or load balancer on a keep-alive
// connection the unconsumed stream prevents Node from finishing the connection,
// so the proxy times out (~10s) and reports a 500 even though the handler ran. Draining the request for bodyless methods
// lets the connection close cleanly.
//
// POST/PUT/PATCH are intentionally NOT drained: those handlers legitimately read
// `request.body` (json/urlencoded) or pipe the stream through busboy.

// The HTTP methods whose handlers never read a request body.
const BODYLESS_METHODS = ['GET', 'DELETE', 'OPTIONS', 'HEAD'];

/**
 * Whether a request with this HTTP method should have its body drained.
 * Case-insensitive; false for anything that is not a known bodyless method.
 * @param {string} method
 * @returns {boolean}
 */
function shouldDrainRequestBody(method) {
  if (typeof method !== 'string') return false;
  return BODYLESS_METHODS.indexOf(method.toUpperCase()) !== -1;
}

/**
 * Drain any stray request body for a bodyless-method request by resuming the
 * stream, so the socket has no pending unread data and the connection can close
 * cleanly. Guarded: a no-op when the request is missing, exposes no `resume`,
 * or carries a body-bearing method. Never throws - a failed resume (e.g. socket
 * already gone) must not break the wrapped handler.
 * @param {object} request Node http IncomingMessage (or a compatible mock)
 * @returns {boolean} true if resume() was invoked, false otherwise
 */
function drainRequestBody(request) {
  if (!request || typeof request.resume !== 'function') return false;
  if (!shouldDrainRequestBody(request.method)) return false;
  try {
    request.resume();
    return true;
  // eslint-disable-next-line sonarjs/no-ignored-exceptions
  } catch (_error) { /* socket already gone - drain is best-effort, never break the handler */
    return false;
  }
}

module.exports = {BODYLESS_METHODS, shouldDrainRequestBody, drainRequestBody};
