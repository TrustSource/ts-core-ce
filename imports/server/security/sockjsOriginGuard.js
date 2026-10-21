// Pure, dependency-free helpers for the SockJS / DDP cross-origin guard.
//
// Written as CommonJS (no Meteor / WebApp imports) so the security decision
// logic can be unit-tested in isolation by the jest harness (see
// test_api/specs/sockjs-origin-guard.spec.js) while still being importable from
// Meteor ESM code. The runtime wiring that hooks these into WebApp.httpServer
// lives in imports/startup/server/sockjs-origin-guard.js.

// Response headers SockJS emits to grant a cross-origin caller read access.
// We strip exactly these for disallowed origins so the browser falls back to
// the same-origin policy.
const CORS_RESPONSE_HEADERS = [
  'access-control-allow-origin',
  'access-control-allow-credentials',
  'access-control-allow-headers'
];

// Normalize a URL (or bare origin) to its scheme://host[:port] origin form,
// matching the shape of the browser-supplied `Origin` request header.
// Returns null when the input cannot be parsed.
function toOrigin(url) {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

// Build the set of origins permitted to open cross-origin SockJS/DDP
// connections. `rootUrl` is this server's public URL (its own origin - the one
// a first-party browser sends on same-origin requests). `extraOrigins` are
// additional operator-trusted first-party origins.
function buildAllowedOrigins({ rootUrl, extraOrigins = [] } = {}) {
  const ownOrigin = toOrigin(rootUrl);
  const allowed = new Set();
  if (ownOrigin) allowed.add(ownOrigin);
  for (const raw of extraOrigins) {
    if (!raw) continue;
    const normalized = toOrigin(raw) || String(raw).trim();
    if (normalized) allowed.add(normalized);
  }
  return { allowed, ownOrigin };
}

// Strip the query string from a request URL.
function pathnameOf(reqUrl) {
  if (!reqUrl) return '';
  const q = reqUrl.indexOf('?');
  return q === -1 ? reqUrl : reqUrl.slice(0, q);
}

// True when the request targets a SockJS endpoint (any transport) or the raw
// /websocket endpoint that Meteor rewrites onto SockJS.
function isSockjsPath(reqUrl, { sockjsPrefix = '/sockjs', websocketPath = '/websocket' } = {}) {
  const p = pathnameOf(reqUrl);
  return p === sockjsPrefix ||
    p.indexOf(sockjsPrefix + '/') === 0 ||
    p === websocketPath ||
    p === websocketPath + '/';
}

// A request is a disallowed cross-origin request when it carries an `Origin`
// header that is not in the allow-list. Requests without an `Origin` header are
// same-origin browser requests or non-browser callers (CORS does not apply) and
// are left untouched.
function isDisallowedOrigin(origin, allowed) {
  if (!origin) return false;
  return !allowed.has(origin);
}

module.exports = {
  CORS_RESPONSE_HEADERS,
  toOrigin,
  buildAllowedOrigins,
  pathnameOf,
  isSockjsPath,
  isDisallowedOrigin
};
