/**
 * Drop-in replacement for Meteor's HTTP package using native fetch().
 * Returns a response object with the same shape as Meteor HTTP:
 *   { statusCode, content, data, headers }
 *
 * Usage:
 *   const result = await httpCall('GET', url, { headers, data, params, auth });
 *   const result = await httpGet(url, options);
 *   const result = await httpPost(url, options);
 */

// On Meteor 2.16 (Node 14), fetch was not a global on the server, so the
// 'fetch' Meteor package provided the polyfill. On Meteor 3 / Node 22+ a global
// fetch exists. Acquire fetch via CommonJS require so the Meteor build still
// resolves the package on the server, while the file stays requireable under
// Jest (which has no 'meteor/fetch' resolver) by falling back to the global.
let fetch;
try {
  ({ fetch } = require('meteor/fetch'));
// eslint-disable-next-line sonarjs/no-ignored-exceptions
} catch (_e) {
  fetch = (...args) => globalThis.fetch(...args);
}

// SSRF egress guard - only engaged when a caller opts in (see validateEgress
// below). Required via CommonJS to match this file's module style and to keep
// the guard Meteor-free / Jest-testable.
const { assertSafeEgressUrl } = require('./security/ssrfGuard');

// Maximum redirect hops to follow when validateEgress is set. Each hop's
// destination is re-validated before it is fetched.
const MAX_REDIRECTS = 5;

// True when two URLs share the same origin (scheme + host + port). Used to
// decide whether credential-bearing headers may be carried across a redirect.
function sameOrigin(a, b) {
  return a.protocol === b.protocol && a.host === b.host;
}

// Credential-bearing headers that must not survive a cross-origin redirect.
// Authorization/Cookie are what native fetch itself strips (WHATWG
// HTTP-redirect-fetch); undici knows nothing about CUSTOM headers, so the API-key
// headers this app sends have to be listed explicitly:
//   x-api-key           - an API key, should an integration send one
//   x-provisioning-key  - a key-minting secret, should an integration send one
// Both are as sensitive as a session cookie and neither is protected by the
// runtime.
//
// SCOPE: this list is NOT a module-wide property. It is consulted only from
// stripCredentialHeaders, which is reachable only from fetchWithEgressGuard,
// which runs only when a caller passes `validateEgress: true`. Any other
// integration that sends an x-api-key is still on the trusted `redirect: 'follow'`
// branch and gains nothing from it - migrating one of them means adding validateEgress at its call site, not editing
// this list.
const CREDENTIAL_HEADERS = new Set([
  'authorization',
  'cookie',
  'x-api-key',
  'x-provisioning-key'
]);

// Headers that describe a request body - the WHATWG "request-body-header name"
// set in full. When a 301/302/303 downgrades the request to a bodyless GET they
// have to go with the body they described - a Content-Length on a bodyless GET
// is a malformed request, and a Content-Type advertises a payload that is no
// longer there. Native fetch deletes all five on a downgrade, so listing all
// five is what keeps the manual loop at parity.
const ENTITY_HEADERS = new Set([
  'content-encoding',
  'content-language',
  'content-location',
  'content-length',
  'content-type'
]);

// Return a shallow copy of `headers` without the named (case-insensitive)
// headers. Never mutates the input so same-origin / non-downgraded hops keep
// their headers intact.
function omitHeaders(headers, names) {
  const out = {};
  for (const key of Object.keys(headers)) {
    if (names.has(key.toLowerCase())) continue;
    out[key] = headers[key];
  }
  return out;
}

function stripCredentialHeaders(headers) {
  return omitHeaders(headers, CREDENTIAL_HEADERS);
}

// True when a redirect must be re-issued as a bodyless GET. WHATWG
// HTTP-redirect-fetch step 11 is NARROWER than "any body-bearing method", and
// this has to match it exactly:
//   301/302 - rewritten ONLY when the method is POST;
//   303     - rewritten for every method except HEAD ("see other, go GET it");
//   307/308 - never; they exist precisely to PRESERVE method and body.
// So DELETE/PUT/PATCH survive a 301/302 unchanged, which is what native fetch
// does. Rewriting them would be a data-integrity bug, not a hardening: a Jira
// host that canonicalises answers jiraRemoveIssue's DELETE with a 301/302, and a
// GET re-issue returns the issue JSON with status 200 - so the delete silently
// becomes a read and is reported to the caller as success.
//
// GET on a 303 takes this branch too. That is a no-op for method and body (a GET
// is already a bodyless GET) and additionally drops the entity headers, which on
// a bodyless GET described nothing.
function downgradesToGet(status, method) {
  return (status === 303 && method !== 'HEAD')
    || ((status === 301 || status === 302) && method === 'POST');
}

// Validate the destination, then follow up to MAX_REDIRECTS hops manually,
// re-validating each hop BEFORE it is fetched. Returns the final (non-redirect)
// response. The SSRF_BLOCKED error from assertSafeEgressUrl propagates before
// any body is read - never leaking an internal response.
async function fetchWithEgressGuard(initialUrl, baseFetchOptions) {
  let currentUrl = initialUrl;
  // redirect:'manual' so a 3xx returns to us with its Location header intact
  // instead of fetch following it to a (possibly internal) target on its own.
  // Headers, method and body are all tracked PER HOP (see below) so the shared
  // base is never mutated and a downgrade on one hop carries into the next.
  const baseHeaders = { ...(baseFetchOptions.headers || {}) };
  let hopHeaders = baseHeaders;
  let hopMethod = baseFetchOptions.method;
  let hopBody = baseFetchOptions.body;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    // Throws SSRF_BLOCKED before any network call if the destination resolves
    // to an internal address.
    await assertSafeEgressUrl(currentUrl);

    const fetchOptions = { ...baseFetchOptions, method: hopMethod, headers: hopHeaders, redirect: 'manual' };
    if (hopBody === undefined) {
      // The base may carry a body this hop must not send; deleting keeps the
      // options identical to a request that never had one.
      delete fetchOptions.body;
    } else {
      fetchOptions.body = hopBody;
    }

    let response;
    try {
      response = await fetch(currentUrl, fetchOptions);
    } catch (networkError) {
      const error = new Error(networkError.message);
      error.code = (networkError.cause && networkError.cause.code) || networkError.code || 'NETWORK_ERROR';
      throw error;
    }

    const isRedirect = response.status >= 300 && response.status < 400;
    const location = isRedirect ? response.headers.get('location') : null;
    if (!isRedirect || !location) {
      // Final response - hand it back to the normal body-reading path.
      return response;
    }

    // Resolve the Location against the current URL and loop to re-validate it.
    const nextUrl = new URL(location, currentUrl);
    // Mirror native fetch's HTTP-redirect-fetch: drop credential-bearing headers
    // (Authorization, Cookie) when the next hop's origin differs from the
    // current one, so a 302 to an attacker-controlled host cannot re-send the
    // victim tenant's Jira Basic-auth / session cookie. Same-origin hops keep
    // them. Clone per-hop so same-origin hops are not mutated.
    if (!sameOrigin(new URL(currentUrl), nextUrl)) {
      hopHeaders = stripCredentialHeaders(hopHeaders);
    }
    // Mirror HTTP-redirect-fetch step 11 as well: where it says so (see
    // downgradesToGet) the next hop becomes a bodyless GET. Without this the loop
    // re-sends the ORIGINAL body to whatever origin the Location names, which may
    // carry sensitive data. The credential strip above removes the key;
    // only this removes the data, and assertSafeEgressUrl cannot help because an
    // attacker's host is public. Applied regardless of origin: a same-origin 302
    // answering a POST still means "look over there with a GET". Cloned, never
    // mutated in place.
    if (downgradesToGet(response.status, hopMethod)) {
      hopMethod = 'GET';
      hopBody = undefined;
      hopHeaders = omitHeaders(hopHeaders, ENTITY_HEADERS);
    }
    currentUrl = nextUrl.toString();
  }

  // Too many redirects.
  const error = new Error('Maximum redirects exceeded');
  error.code = 'TOO_MANY_REDIRECTS';
  throw error;
}

// Opt-in bounds for a request to a URL the caller does not control. Neither
// applies unless it is passed, so every other caller keeps its original fetch:
//   timeoutMs - the whole request, body included, rejects with code ETIMEDOUT
//               once that many milliseconds have passed, and the fetch is aborted;
//   maxBytes  - a response whose Content-Length is larger rejects with code
//               RESPONSE_TOO_LARGE before its body is read; any other body is read
//               as a stream and the fetch is aborted as soon as more than maxBytes
//               bytes have arrived.
function isLimit(value) {
  return typeof value === 'number' && value > 0;
}

function limitError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function readBodyWithin(response, maxBytes, controller) {
  if (Number(response.headers.get('content-length')) > maxBytes) {
    controller.abort();
    throw limitError('RESPONSE_TOO_LARGE', `Response exceeds ${maxBytes} bytes`);
  }
  const chunks = [];
  let total = 0;
  // A WHATWG ReadableStream (native fetch) and a Node stream (node-fetch behind
  // meteor/fetch) are both async iterable; leaving the loop early cancels the stream.
  for await (const chunk of response.body || []) {
    total += chunk.length;
    if (total > maxBytes) {
      controller.abort();
      throw limitError('RESPONSE_TOO_LARGE', `Response exceeds ${maxBytes} bytes`);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, total);
}

// IMPORTANT: any NEW integration that fetches a user-supplied URL must pass
// `validateEgress: true` so the destination (and every redirect hop) is
// SSRF-validated at fetch time. Trusted internal callers (the 24+ existing
// integrations against fixed/own infrastructure) leave it unset, preserving the
// original native fetch behavior byte-for-byte.
//
// `controller` is null unless the caller passed timeoutMs or maxBytes (see httpCall).
async function request(method, url, options, controller) {
  const fetchOptions = {
    method: method.toUpperCase()
  };

  // Build headers
  const headers = { ...(options.headers || {}) };

  // Handle basic auth (user:password string)
  if (options.auth) {
    const base64 = Buffer.from(options.auth).toString('base64');
    headers['Authorization'] = `Basic ${base64}`;
  }

  // Handle query params
  if (options.params) {
    const queryString = new URLSearchParams(options.params).toString();
    const separator = url.includes('?') ? '&' : '?';
    url = url + separator + queryString;
  }

  // Handle request body (GET/HEAD cannot have a body)
  const upperMethod = fetchOptions.method;
  if (upperMethod !== 'GET' && upperMethod !== 'HEAD') {
    if (options.data !== undefined) {
      if (!headers['Content-Type']) {
        headers['Content-Type'] = 'application/json';
      }
      fetchOptions.body = typeof options.data === 'string'
        ? options.data
        : JSON.stringify(options.data);
    } else if (options.content !== undefined) {
      fetchOptions.body = options.content;
    }
  }

  fetchOptions.headers = headers;
  if (controller) {
    fetchOptions.signal = controller.signal;
  }

  let response;
  if (options.validateEgress) {
    // Opt-in SSRF egress validation. Validate the FINAL url (params already
    // appended), follow redirects manually, and re-validate every hop's
    // destination BEFORE fetching it. A blocked destination throws the
    // SSRF_BLOCKED error before any response body is read.
    response = await fetchWithEgressGuard(url, fetchOptions);
  } else {
    // Trusted-caller path - unchanged native fetch (default redirect handling).
    try {
      response = await fetch(url, fetchOptions);
    } catch (networkError) {
      // Mimic Meteor HTTP error shape for network errors
      const error = new Error(networkError.message);
      error.code = (networkError.cause && networkError.cause.code) || networkError.code || 'NETWORK_ERROR';
      throw error;
    }
  }

  // Read response body
  let content;
  const isBinary = options.npmRequestOptions && options.npmRequestOptions.encoding === null;
  if (controller && isLimit(options.maxBytes)) {
    const buffer = await readBodyWithin(response, options.maxBytes, controller);
    // TextDecoder decodes exactly as response.text() does (UTF-8, BOM dropped).
    content = isBinary ? buffer : new TextDecoder().decode(buffer);
  } else if (isBinary) {
    const buffer = await response.arrayBuffer();
    content = Buffer.from(buffer);
  } else {
    content = await response.text();
  }

  // Build response headers object
  const responseHeaders = {};
  response.headers.forEach((value, key) => {
    responseHeaders[key] = value;
  });

  // Parse JSON if applicable
  let data = null;
  const contentType = responseHeaders['content-type'] || '';
  if (contentType.includes('application/json') || contentType.includes('text/json')) {
    try {
      data = JSON.parse(content);
    // eslint-disable-next-line sonarjs/no-ignored-exceptions
    } catch (e) {
      // not valid JSON, leave data as null
    }
  }

  const result = {
    statusCode: response.status,
    content,
    data,
    headers: responseHeaders
  };

  // Throw on HTTP errors (4xx, 5xx) - matches Meteor HTTP behavior
  if (!response.ok) {
    const error = new Error(`${response.status} ${response.statusText}`);
    error.response = result;
    throw error;
  }

  return result;
}

async function httpCall(method, url, options = {}) {
  const timeoutMs = options.timeoutMs;
  if (!isLimit(timeoutMs) && !isLimit(options.maxBytes)) {
    return request(method, url, options, null);
  }
  const controller = new AbortController();
  if (!isLimit(timeoutMs)) {
    return request(method, url, options, controller);
  }
  let timer;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      reject(limitError('ETIMEDOUT', `Request timed out after ${timeoutMs} ms`));
      controller.abort();
    }, timeoutMs);
  });
  try {
    // Raced as well as aborted: the egress guard's DNS lookup takes no signal, and
    // the caller is answered on time either way.
    return await Promise.race([request(method, url, options, controller), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function httpGet(url, options = {}) {
  return httpCall('GET', url, options);
}

async function httpPost(url, options = {}) {
  return httpCall('POST', url, options);
}

module.exports = { httpCall, httpGet, httpPost };
