/* eslint-disable no-undef */
// SSRF egress-validation tests for assertSafeEgressUrl (imports/lib/security/
// ssrfGuard.js) and the validateEgress branch of httpCall (imports/lib/
// httpFetch.js).
//
// The egress guard is the AUTHORITATIVE layer: it resolves the destination
// host via DNS at fetch time and refuses if ANY resolved address is internal.
// This is what stops DNS-rebinding (a public hostname that resolves to
// 169.254.169.254), redirect-to-internal (a 302 Location pointing at 10.x),
// and mixed-record attacks. node:dns/promises is mocked so we can hand the
// guard attacker-chosen records; global fetch is stubbed so no real network
// I/O happens.
//
// SECURITY NOTE: every "blocked" case asserts fetch is NOT called against the
// internal target and that the rejection error contains NO resolved IP and NO
// response body (no SSRF oracle). The flag-off case proves the 24+ trusted
// callers that do NOT pass validateEgress are byte-for-byte unaffected.

// Mock DNS before requiring the guard / httpFetch.
jest.mock('node:dns/promises', () => ({
  lookup: jest.fn()
}));
// httpFetch.js falls back to the global fetch when meteor/fetch is absent
// (Jest). Stub the global so the redirect loop can be driven deterministically.
const dns = require('node:dns/promises');

const {assertSafeEgressUrl} = require('../../imports/lib/security/ssrfGuard');
const {httpCall} = require('../../imports/lib/httpFetch');

function makeResponse({status = 200, headers = {}, body = ''} = {}) {
  const lower = {};
  for (const k of Object.keys(headers)) lower[k.toLowerCase()] = headers[k];
  return {
    status,
    statusText: status === 200 ? 'OK' : 'Found',
    ok: status >= 200 && status < 300,
    headers: {
      get: (name) => (name.toLowerCase() in lower ? lower[name.toLowerCase()] : null),
      forEach: (cb) => Object.keys(lower).forEach((k) => cb(lower[k], k))
    },
    text: async () => body,
    arrayBuffer: async () => Buffer.from(body)
  };
}

beforeEach(() => {
  dns.lookup.mockReset();
  global.fetch = jest.fn();
});

afterEach(() => {
  delete global.fetch;
});

describe('assertSafeEgressUrl - DNS resolution gate', () => {
  it('rejects a DNS-rebinding host that resolves to a metadata IP', async () => {
    dns.lookup.mockResolvedValue([{address: '169.254.169.254', family: 4}]);
    let err;
    try {
      await assertSafeEgressUrl('https://rebind.attacker.test/');
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('SSRF_BLOCKED');
    expect(err.message).not.toMatch(/169\.254\.169\.254/);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('rejects when ANY of the mixed records is internal', async () => {
    dns.lookup.mockResolvedValue([
      {address: '93.184.216.34', family: 4}, // public
      {address: '10.0.0.5', family: 4}       // internal - poisons the set
    ]);
    await expect(assertSafeEgressUrl('https://mixed.attacker.test/'))
      .rejects.toMatchObject({code: 'SSRF_BLOCKED'});
  });

  it('rejects a literal internal IP without doing DNS', async () => {
    await expect(assertSafeEgressUrl('http://10.0.0.5/'))
      .rejects.toMatchObject({code: 'SSRF_BLOCKED'});
    expect(dns.lookup).not.toHaveBeenCalled();
  });

  it('rejects a literal encoded-IP target pre-DNS', async () => {
    await expect(assertSafeEgressUrl('http://0x7f000001/'))
      .rejects.toMatchObject({code: 'SSRF_BLOCKED'});
  });

  it('rejects a non-http(s) scheme pre-DNS', async () => {
    await expect(assertSafeEgressUrl('gopher://example.com/'))
      .rejects.toMatchObject({code: 'SSRF_BLOCKED'});
    await expect(assertSafeEgressUrl('file:///etc/passwd'))
      .rejects.toMatchObject({code: 'SSRF_BLOCKED'});
    expect(dns.lookup).not.toHaveBeenCalled();
  });

  it('resolves to {url, addresses} for a public host that resolves public', async () => {
    dns.lookup.mockResolvedValue([{address: '93.184.216.34', family: 4}]);
    const out = await assertSafeEgressUrl('https://example.com/path');
    expect(out.url.hostname).toBe('example.com');
    expect(out.addresses).toContain('93.184.216.34');
  });
});

describe('httpCall - validateEgress redirect loop', () => {
  it('refuses a redirect-to-internal: re-validates next hop, no body returned', async () => {
    // Public host resolves public; first hop is a 302 -> internal Location.
    dns.lookup.mockImplementation(async (host) => {
      if (host === 'public.example.test') return [{address: '93.184.216.34', family: 4}];
      throw new Error('unexpected host ' + host);
    });
    global.fetch.mockResolvedValueOnce(makeResponse({
      status: 302,
      headers: {Location: 'http://10.0.0.5/secret'},
      body: ''
    }));

    let err;
    try {
      await httpCall('GET', 'https://public.example.test/start', {validateEgress: true});
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('SSRF_BLOCKED');
    // The internal hop was never fetched (validation happens before the 2nd fetch).
    expect(global.fetch).toHaveBeenCalledTimes(1);
    // No internal IP and no body leaked through the error.
    expect(err.message).not.toMatch(/10\.0\.0\.5/);
    expect(err.message).not.toMatch(/secret/);
  });

  it('follows a redirect to another PUBLIC host and returns its body', async () => {
    dns.lookup.mockImplementation(async (host) => {
      if (host === 'a.example.test') return [{address: '93.184.216.34', family: 4}];
      if (host === 'b.example.test') return [{address: '93.184.216.35', family: 4}];
      throw new Error('unexpected host ' + host);
    });
    global.fetch
      .mockResolvedValueOnce(makeResponse({status: 302, headers: {Location: 'https://b.example.test/final'}}))
      .mockResolvedValueOnce(makeResponse({
        status: 200,
        headers: {'content-type': 'application/json'},
        body: '{"ok":true}'
      }));

    const res = await httpCall('GET', 'https://a.example.test/start', {validateEgress: true});
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(res.statusCode).toBe(200);
    expect(res.data).toEqual({ok: true});
  });

  it('blocks a non-http(s) scheme before any fetch', async () => {
    await expect(httpCall('GET', 'gopher://example.com/', {validateEgress: true}))
      .rejects.toMatchObject({code: 'SSRF_BLOCKED'});
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('happy path: public host + public IP + 200 returns the normal shape', async () => {
    dns.lookup.mockResolvedValue([{address: '93.184.216.34', family: 4}]);
    global.fetch.mockResolvedValueOnce(makeResponse({
      status: 200,
      headers: {'content-type': 'application/json'},
      body: '{"value":42}'
    }));

    const res = await httpCall('GET', 'https://example.com/data', {validateEgress: true});
    expect(res).toEqual(expect.objectContaining({
      statusCode: 200,
      content: '{"value":42}',
      data: {value: 42}
    }));
    expect(res.headers['content-type']).toBe('application/json');
  });
});

describe('httpCall - flag OFF leaves trusted callers unaffected', () => {
  it('does NOT validate egress and still fetches an internal target', async () => {
    // Same internal target as the blocked egress case, but no validateEgress.
    global.fetch.mockResolvedValueOnce(makeResponse({
      status: 200,
      headers: {'content-type': 'application/json'},
      body: '{"internal":true}'
    }));

    const res = await httpCall('GET', 'http://10.0.0.5/internal');
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith('http://10.0.0.5/internal', expect.any(Object));
    expect(res.statusCode).toBe(200);
    expect(res.data).toEqual({internal: true});
    // DNS guard never engaged.
    expect(dns.lookup).not.toHaveBeenCalled();
  });

  it('does NOT set redirect=manual when the flag is off (native default kept)', async () => {
    global.fetch.mockResolvedValueOnce(makeResponse({status: 200, body: 'ok'}));
    await httpCall('GET', 'http://10.0.0.5/internal');
    const passedOpts = global.fetch.mock.calls[0][1];
    expect(passedOpts.redirect).toBeUndefined();
  });
});
