import { Meteor } from 'meteor/meteor';
import { WebApp } from 'meteor/webapp';
import { Config } from '/imports/server/config';
import {
  CORS_RESPONSE_HEADERS,
  buildAllowedOrigins,
  isSockjsPath,
  isDisallowedOrigin
} from '/imports/server/security/sockjsOriginGuard';

// ---------------------------------------------------------------------------
// SockJS / DDP cross-origin guard
//
// Meteor's SockJS server (ddp-server) reflects ANY `Origin` request header back
// in `Access-Control-Allow-Origin` together with `Access-Control-Allow-Credentials:
// true` on every XHR / EventSource transport, and accepts WebSocket upgrades from
// any origin (WebSockets are not subject to the browser CORS check at all). That
// lets a page on an untrusted origin open a *credentialed* DDP connection to this
// server and replay a victim's resume token / run DDP methods cross-origin.
//
// SockJS installs its listeners directly on `WebApp.httpServer` *before* any
// connect middleware (see ddp-server/stream_server.js), so helmet / WebApp
// handlers cannot reach `/sockjs/`. We therefore intercept at the raw
// http.Server level via prependListener:
//
//   • 'request'  (xhr, xhr_send, xhr_streaming, eventsource, htmlfile, jsonp,
//                 info, chunking_test) - for a disallowed cross-origin request we
//                 suppress the permissive CORS response headers SockJS would emit,
//                 restoring the browser same-origin policy (the cross-origin page
//                 can no longer read the response).
//
//   • 'upgrade'  (websocket) - not gated by CORS in the browser, so we actively
//                 reject the handshake for a disallowed cross-origin request.
//
// Same-origin requests (no `Origin`, or `Origin` === this server's own origin)
// and explicitly allow-listed origins are left untouched, so SockJS keeps working
// exactly as before for first-party traffic.
//
// Escape hatches: TS_ALLOWED_DDP_ORIGINS (comma-separated extra origins) and
// TS_DISABLE_SOCKJS_ORIGIN_GUARD=true (kill switch).
// ---------------------------------------------------------------------------

const runtimeConfig = globalThis.__meteor_runtime_config__ || {};
const PATH_PREFIX = runtimeConfig.ROOT_URL_PATH_PREFIX || '';
const SOCKJS_PATH_OPTS = {
  sockjsPrefix: PATH_PREFIX + '/sockjs',
  websocketPath: PATH_PREFIX + '/websocket'
};

Meteor.startup(function () {
  if (process.env.TS_DISABLE_SOCKJS_ORIGIN_GUARD === 'true') {
    console.warn('[sockjs-origin-guard] disabled via TS_DISABLE_SOCKJS_ORIGIN_GUARD');
    return;
  }

  const extraOrigins = (process.env.TS_ALLOWED_DDP_ORIGINS || '').split(',');
  const { allowed, ownOrigin } = buildAllowedOrigins({
    rootUrl: runtimeConfig.ROOT_URL || Config.ROOT_URL,
    extraOrigins
  });

  if (!ownOrigin) {
    // Without a known own-origin we cannot distinguish first-party traffic and
    // would risk blocking the app itself - skip activation and warn loudly.
    console.error('[sockjs-origin-guard] could not derive own origin from ROOT_URL; ' +
      'cross-origin SockJS guard NOT installed');
    return;
  }

  const httpServer = WebApp.httpServer;

  // 'request': neutralise SockJS's reflected CORS headers for disallowed origins.
  httpServer.prependListener('request', function (req, res) {
    if (!isSockjsPath(req.url, SOCKJS_PATH_OPTS)) return;
    if (!isDisallowedOrigin(req.headers && req.headers.origin, allowed)) return;

    const originalSetHeader = res.setHeader;
    res.setHeader = function (name, value) {
      if (name && CORS_RESPONSE_HEADERS.indexOf(String(name).toLowerCase()) !== -1) {
        return res; // drop the permissive cross-origin header
      }
      return originalSetHeader.call(this, name, value);
    };
  });

  // 'upgrade': reject WebSocket handshakes from disallowed origins (WebSockets
  // are not protected by the browser CORS check, so we must enforce server-side).
  httpServer.prependListener('upgrade', function (req, socket) {
    if (!isSockjsPath(req.url, SOCKJS_PATH_OPTS)) return;
    if (!isDisallowedOrigin(req.headers && req.headers.origin, allowed)) return;

    // Stop SockJS (a later listener on the same event) from adopting this socket
    // by making the URL no longer match its prefix, then refuse the handshake.
    req.url = '/__origin_blocked__';
    try {
      socket.on('error', function () {}); // swallow any late EPIPE on teardown
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    } catch {
      try { socket.destroy(); } catch { /* already gone */ }
    }
  });

  if (Config.DEBUG_MODE_ENABLED) {
    console.log('[sockjs-origin-guard] active; allowed origins: ' +
      Array.from(allowed).join(', '));
  }
});
