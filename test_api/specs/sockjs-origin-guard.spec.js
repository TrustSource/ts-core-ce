/* eslint-disable no-undef */
// Unit tests for the pure SockJS/DDP cross-origin decision logic.
// No running server required - exercises the helpers directly.
const {
  toOrigin,
  buildAllowedOrigins,
  pathnameOf,
  isSockjsPath,
  isDisallowedOrigin,
  CORS_RESPONSE_HEADERS
} = require('../../imports/server/security/sockjsOriginGuard');

describe('sockjsOriginGuard', () => {
  describe('toOrigin', () => {
    it('normalizes a full URL to its origin', () => {
      expect(toOrigin('https://app.trustsource.io/path?q=1')).toBe('https://app.trustsource.io');
    });
    it('drops default ports and keeps non-default ports', () => {
      expect(toOrigin('https://app.trustsource.io:443')).toBe('https://app.trustsource.io');
      expect(toOrigin('http://localhost:3000')).toBe('http://localhost:3000');
    });
    it('returns null for unparsable input', () => {
      expect(toOrigin('not a url')).toBeNull();
      expect(toOrigin('')).toBeNull();
      expect(toOrigin(undefined)).toBeNull();
    });
  });

  describe('buildAllowedOrigins', () => {
    it('always includes the server own origin derived from rootUrl', () => {
      const { allowed, ownOrigin } = buildAllowedOrigins({ rootUrl: 'https://app.trustsource.io' });
      expect(ownOrigin).toBe('https://app.trustsource.io');
      expect(allowed.has('https://app.trustsource.io')).toBe(true);
    });
    it('adds normalized extra origins and ignores blanks', () => {
      const { allowed } = buildAllowedOrigins({
        rootUrl: 'https://app.trustsource.io',
        extraOrigins: ['https://partner.trustsource.io/', '', null, '  ']
      });
      expect(allowed.has('https://partner.trustsource.io')).toBe(true);
      expect(allowed.size).toBe(2);
    });
    it('returns null ownOrigin when rootUrl is unusable', () => {
      const { ownOrigin } = buildAllowedOrigins({ rootUrl: undefined });
      expect(ownOrigin).toBeNull();
    });
  });

  describe('pathnameOf', () => {
    it('strips the query string', () => {
      expect(pathnameOf('/sockjs/123/abc/xhr?foo=bar')).toBe('/sockjs/123/abc/xhr');
      expect(pathnameOf('/sockjs/info')).toBe('/sockjs/info');
    });
  });

  describe('isSockjsPath', () => {
    it('matches sockjs transports and info', () => {
      expect(isSockjsPath('/sockjs/info')).toBe(true);
      expect(isSockjsPath('/sockjs/000/abcdefgh/xhr')).toBe(true);
      expect(isSockjsPath('/sockjs/000/abcdefgh/websocket')).toBe(true);
      expect(isSockjsPath('/sockjs')).toBe(true);
    });
    it('matches the raw /websocket endpoint', () => {
      expect(isSockjsPath('/websocket')).toBe(true);
      expect(isSockjsPath('/websocket/')).toBe(true);
    });
    it('does not match the REST API or app routes', () => {
      expect(isSockjsPath('/api/v2/core/modules/abc')).toBe(false);
      expect(isSockjsPath('/dashboard')).toBe(false);
      expect(isSockjsPath('/sockjssomethingelse')).toBe(false);
    });
    it('honors a path prefix', () => {
      const opts = { sockjsPrefix: '/ts/sockjs', websocketPath: '/ts/websocket' };
      expect(isSockjsPath('/ts/sockjs/info', opts)).toBe(true);
      expect(isSockjsPath('/sockjs/info', opts)).toBe(false);
    });
  });

  describe('isDisallowedOrigin', () => {
    const { allowed } = buildAllowedOrigins({
      rootUrl: 'https://app.trustsource.io',
      extraOrigins: ['https://partner.trustsource.io']
    });

    it('allows requests with no Origin header (same-origin / non-browser)', () => {
      expect(isDisallowedOrigin(undefined, allowed)).toBe(false);
      expect(isDisallowedOrigin('', allowed)).toBe(false);
    });
    it('allows the server own origin and allow-listed origins', () => {
      expect(isDisallowedOrigin('https://app.trustsource.io', allowed)).toBe(false);
      expect(isDisallowedOrigin('https://partner.trustsource.io', allowed)).toBe(false);
    });
    it('disallows untrusted and sibling-subdomain origins', () => {
      expect(isDisallowedOrigin('https://attacker.com', allowed)).toBe(true);
      expect(isDisallowedOrigin('https://csaf.trustsource.io', allowed)).toBe(true);
      expect(isDisallowedOrigin('null', allowed)).toBe(true);
    });
  });

  describe('CORS_RESPONSE_HEADERS', () => {
    it('targets the permissive cross-origin headers SockJS emits', () => {
      expect(CORS_RESPONSE_HEADERS).toEqual(
        expect.arrayContaining(['access-control-allow-origin', 'access-control-allow-credentials'])
      );
    });
  });
});
