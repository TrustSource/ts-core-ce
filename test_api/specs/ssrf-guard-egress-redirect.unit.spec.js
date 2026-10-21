/* eslint-disable no-undef */
// SSRF egress-layer GAP coverage - complements ssrf-guard-egress.unit.spec.js.
//
// The dev's egress spec proves DNS-rebinding, mixed records, one redirect hop,
// scheme block, happy path and flag-off. This file closes the remaining
// acceptance-criteria / adversarial gaps for the AUTHORITATIVE egress gate
// (assertSafeEgressUrl) and the validateEgress redirect loop in httpCall
// (imports/lib/httpFetch.js):
//
//   - redirect hop-cap: a >MAX_REDIRECTS public chain must terminate with
//     TOO_MANY_REDIRECTS, not hang or recurse;
//   - a 3xx with NO Location header is treated as final (1 fetch, no loop);
//   - a RELATIVE Location is resolved against the base and re-validated;
//   - the `#` / `?` suffix bypass at the EGRESS layer (not just input);
//   - userinfo confusion (user@host) is judged on the REAL host;
//   - uppercase/mixed-case hex literal (0X7F000001);
//   - bracketed IPv6 literal forms (loopback, mapped-internal) at egress;
//   - the flag-OFF path never calls dns.lookup (no perf/behavior change for
//     the 24+ trusted callers) - reinforced for the redirect-bearing case;
//   - the egress error never includes the resolved IP or response body.
//
// SECURITY NOTE: every "blocked" case is a real SSRF bypass class. If one flips
// to passing, the egress gate regressed - fix the guard, do NOT relax the test.
//
// REGRESSION GUARD (see the final describe block): the egress IP classifier must
// block an IPv4-mapped IPv6 address that a (malicious / rebinding) resolver
// returns in canonical hex-grouped form, e.g. `::ffff:a9fe:a9fe` == 169.254.169.254
// (cloud metadata). This was an exploitable DNS-rebinding bypass when isBlockedIp
// only unwrapped the short DOTTED textual form `::ffff:a.b.c.d`; it is now fixed in
// production (ssrfGuard.js unwraps any net.isIP===6 value via its 16 binary bytes).
// These tests lock the fix in - if one flips to passing-as-allowed, the guard
// regressed: fix the guard, do NOT relax the test.

jest.mock('node:dns/promises', () => ({
  lookup: jest.fn()
}));
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

describe('httpCall - validateEgress redirect hop-cap', () => {
  it('terminates a >MAX_REDIRECTS public chain with TOO_MANY_REDIRECTS (no hang)', async () => {
    // Every public host resolves public; every hop is a 302 to another public
    // host - an infinite redirect chain the loop must bound, not follow forever.
    dns.lookup.mockResolvedValue([{address: '93.184.216.34', family: 4}]);
    global.fetch.mockImplementation(async () =>
      makeResponse({status: 302, headers: {Location: 'https://public.example.test/next'}}));

    let err;
    try {
      await httpCall('GET', 'https://public.example.test/start', {validateEgress: true});
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('TOO_MANY_REDIRECTS');
    // MAX_REDIRECTS = 5 -> hops 0..5 inclusive = 6 fetches, then it stops.
    expect(global.fetch.mock.calls.length).toBeLessThanOrEqual(6);
    expect(global.fetch.mock.calls.length).toBeGreaterThan(1);
  });

  it('a 3xx with NO Location header is treated as final (single fetch, no loop)', async () => {
    dns.lookup.mockResolvedValue([{address: '93.184.216.34', family: 4}]);
    // 302 but no Location -> not a followable redirect -> handed back as final.
    // Final response is not ok (status 302) so httpCall surfaces the HTTP error,
    // NOT an SSRF/redirect loop. The point: exactly one fetch, no hang.
    global.fetch.mockResolvedValueOnce(makeResponse({status: 302, headers: {}, body: 'x'}));

    let err;
    try {
      await httpCall('GET', 'https://public.example.test/x', {validateEgress: true});
    } catch (e) {
      err = e;
    }
    expect(global.fetch).toHaveBeenCalledTimes(1);
    // It is an ordinary HTTP-error throw, not a redirect-loop / SSRF error.
    expect(err.code).not.toBe('TOO_MANY_REDIRECTS');
    expect(err.code).not.toBe('SSRF_BLOCKED');
  });

  it('resolves a RELATIVE Location against the base and re-validates it', async () => {
    dns.lookup.mockImplementation(async (host) => {
      if (host === 'public.example.test') return [{address: '93.184.216.34', family: 4}];
      throw new Error('unexpected host ' + host);
    });
    global.fetch
      .mockResolvedValueOnce(makeResponse({status: 302, headers: {Location: '/elsewhere'}}))
      .mockResolvedValueOnce(makeResponse({
        status: 200,
        headers: {'content-type': 'application/json'},
        body: '{"ok":1}'
      }));

    const res = await httpCall('GET', 'https://public.example.test/start', {validateEgress: true});
    expect(global.fetch).toHaveBeenCalledTimes(2);
    // The relative Location was joined onto the base origin and re-fetched.
    expect(global.fetch.mock.calls[1][0]).toBe('https://public.example.test/elsewhere');
    expect(res.statusCode).toBe(200);
    expect(res.data).toEqual({ok: 1});
  });

  it('blocks a relative Location that escapes to an internal host? (stays same host) - re-validates every hop', async () => {
    // A relative Location cannot change the host, so this confirms the SAME host
    // is re-validated on each hop (defense even when the host is unchanged).
    dns.lookup.mockResolvedValue([{address: '93.184.216.34', family: 4}]);
    global.fetch
      .mockResolvedValueOnce(makeResponse({status: 301, headers: {Location: '/a'}}))
      .mockResolvedValueOnce(makeResponse({status: 301, headers: {Location: '/b'}}))
      .mockResolvedValueOnce(makeResponse({status: 200, headers: {'content-type': 'text/plain'}, body: 'done'}));

    const res = await httpCall('GET', 'https://public.example.test/start', {validateEgress: true});
    // host resolved on hop 0, 1 and 2 -> 3 dns lookups, 3 fetches.
    expect(dns.lookup.mock.calls.length).toBe(3);
    expect(global.fetch).toHaveBeenCalledTimes(3);
    expect(res.content).toBe('done');
  });
});

describe('httpCall - validateEgress strips credentials on a cross-host redirect', () => {
  it('does NOT forward Authorization/Cookie to a DIFFERENT-origin redirect hop', async () => {
    // Native fetch strips Authorization & Cookie on a cross-origin redirect
    // (WHATWG HTTP-redirect-fetch). The manual loop must replicate that or it
    // re-sends the victim tenant's Jira Basic-auth creds to an attacker host.
    dns.lookup.mockImplementation(async (host) => {
      if (host === 'jira.example.test') return [{address: '93.184.216.34', family: 4}];
      if (host === 'attacker.example.test') return [{address: '198.51.100.7', family: 4}];
      throw new Error('unexpected host ' + host);
    });
    global.fetch
      .mockResolvedValueOnce(makeResponse({
        status: 302,
        headers: {Location: 'https://attacker.example.test/steal'}
      }))
      .mockResolvedValueOnce(makeResponse({
        status: 200,
        headers: {'content-type': 'text/plain'},
        body: 'ok'
      }));

    await httpCall('GET', 'https://jira.example.test/rest/api/2/issue/X', {
      auth: 'tenant:secret',
      headers: {Cookie: 'session=abc'},
      validateEgress: true
    });

    expect(global.fetch).toHaveBeenCalledTimes(2);
    const firstHopHeaders = global.fetch.mock.calls[0][1].headers;
    const crossHopHeaders = global.fetch.mock.calls[1][1].headers;
    // First (same-origin) hop carries the credentials.
    expect(firstHopHeaders.Authorization).toMatch(/^Basic /);
    expect(firstHopHeaders.Cookie).toBe('session=abc');
    // Cross-origin hop must have them removed (case-insensitive).
    const crossKeys = Object.keys(crossHopHeaders).map((k) => k.toLowerCase());
    expect(crossKeys).not.toContain('authorization');
    expect(crossKeys).not.toContain('cookie');
  });

  // Authorization/Cookie are not the only credential-bearing headers this app
  // sends. The ts-psirt (CVD) integration authenticates with `x-api-key` and
  // provisions company keys with `x-provisioning-key` - the credential that MINTS
  // API keys upstream. Undici strips Authorization across a cross-origin redirect
  // but knows nothing about custom headers, so without this the provisioning
  // secret would be re-sent to whatever host a 302 named.
  it.each([
    ['x-api-key', 'company-api-key-value'],
    ['x-provisioning-key', 'provisioning-secret-value'],
    ['X-Provisioning-Key', 'provisioning-secret-value']
  ])('does NOT forward %s to a DIFFERENT-origin redirect hop', async (header, value) => {
    dns.lookup.mockImplementation(async (host) => {
      if (host === 'psirt.example.test') return [{address: '93.184.216.34', family: 4}];
      if (host === 'attacker.example.test') return [{address: '198.51.100.7', family: 4}];
      throw new Error('unexpected host ' + host);
    });
    global.fetch
      .mockResolvedValueOnce(makeResponse({
        status: 302,
        headers: {Location: 'https://attacker.example.test/steal'}
      }))
      .mockResolvedValueOnce(makeResponse({
        status: 200,
        headers: {'content-type': 'application/json'},
        body: '{}'
      }));

    await httpCall('POST', 'https://psirt.example.test/svc/api/eacg/service-keys', {
      headers: {'Content-Type': 'application/json', Accept: 'application/json', [header]: value},
      data: {company_id: 'ts-app'},
      validateEgress: true
    });

    expect(global.fetch).toHaveBeenCalledTimes(2);
    // First (same-origin) hop still carries it - the strip is not blanket.
    expect(global.fetch.mock.calls[0][1].headers[header]).toBe(value);

    const crossHopHeaders = global.fetch.mock.calls[1][1].headers;
    const crossKeys = Object.keys(crossHopHeaders).map((k) => k.toLowerCase());
    expect(crossKeys).not.toContain(header.toLowerCase());
    // The secret value must not survive under ANY key.
    expect(Object.values(crossHopHeaders)).not.toContain(value);
    // Non-credential, non-entity headers are untouched - the strip is targeted,
    // not a blanket clear. Asserted on Accept rather than Content-Type: this is a
    // POST answered with a 302, so Content-Type is now (correctly) dropped by the
    // method/body downgrade below, for an entirely different reason. Using it here
    // would conflate the two mechanisms and stop testing this one.
    expect(crossHopHeaders.Accept).toBe('application/json');
  });

  it('KEEPS x-api-key on a SAME-origin redirect hop', async () => {
    dns.lookup.mockResolvedValue([{address: '93.184.216.34', family: 4}]);
    global.fetch
      .mockResolvedValueOnce(makeResponse({status: 302, headers: {Location: '/moved'}}))
      .mockResolvedValueOnce(makeResponse({status: 200, headers: {'content-type': 'text/plain'}, body: 'ok'}));

    await httpCall('GET', 'https://psirt.example.test/svc/api/eacg/cases', {
      headers: {'x-api-key': 'company-api-key-value'},
      validateEgress: true
    });

    expect(global.fetch.mock.calls[1][1].headers['x-api-key']).toBe('company-api-key-value');
  });

  it('KEEPS Authorization/Cookie on a SAME-origin redirect hop', async () => {
    dns.lookup.mockResolvedValue([{address: '93.184.216.34', family: 4}]);
    global.fetch
      .mockResolvedValueOnce(makeResponse({status: 302, headers: {Location: '/moved'}}))
      .mockResolvedValueOnce(makeResponse({status: 200, headers: {'content-type': 'text/plain'}, body: 'ok'}));

    await httpCall('GET', 'https://jira.example.test/a', {
      auth: 'tenant:secret',
      headers: {Cookie: 'session=abc'},
      validateEgress: true
    });

    expect(global.fetch).toHaveBeenCalledTimes(2);
    const sameHopHeaders = global.fetch.mock.calls[1][1].headers;
    expect(sameHopHeaders.Authorization).toMatch(/^Basic /);
    expect(sameHopHeaders.Cookie).toBe('session=abc');
  });
});

// ---------------------------------------------------------------------------
// GAP-CLOSING ADDITIONS (test-automation pass) for the CREDENTIAL_HEADERS strip.
//
// The block above proves the two CVD headers are dropped on one cross-origin hop
// and that x-api-key survives one same-origin hop. What it does not pin down is
// everything that decides WHICH hops count as cross-origin, and what happens on
// a chain longer than one hop:
//
//   - the strip is STICKY: once dropped, a later hop back to the ORIGINAL origin
//     must not resurrect the credential (redirect laundering: attacker bounces
//     A -> attacker -> A so the final request looks same-origin again);
//   - a scheme downgrade (https -> http) and a port change on the SAME hostname
//     are both cross-origin, because the credential must not travel in clear or
//     to a different service on the same box;
//   - x-provisioning-key must be KEPT same-origin - the header list must not have
//     turned into a blanket "always drop", which would silently break provisioning
//     against any upstream that answers a 302 to itself;
//   - `X-Api-Key` in the app's own casing is matched (the mandate's spelling; the
//     block above only proves case-insensitivity for the provisioning header);
//   - the strip never mutates the CALLER's headers object.
//
// Each of these is a direction the current implementation gets right; they are
// asserted so a refactor of sameOrigin()/stripCredentialHeaders() cannot quietly
// flip one.
// ---------------------------------------------------------------------------
describe('httpCall - credential strip: cross-origin classification and stickiness', () => {
  const KEY = 'company-api-key-value';

  // Two public hosts; everything below resolves public so nothing is blocked for
  // SSRF reasons and the assertions are purely about credential handling.
  function mockPublicDns() {
    dns.lookup.mockImplementation(async (host) => {
      if (host === 'psirt.example.test') return [{address: '93.184.216.34', family: 4}];
      if (host === 'attacker.example.test') return [{address: '198.51.100.7', family: 4}];
      throw new Error('unexpected host ' + host);
    });
  }

  it('the strip is STICKY: a hop BACK to the original origin does not restore the credential', async () => {
    // Redirect laundering. psirt -> attacker -> psirt. If the classifier compared
    // each hop against the ORIGINAL url (or re-derived headers from the base),
    // the final hop would look same-origin and re-attach the key - after the
    // attacker host has already seen the request. Once dropped, it stays dropped.
    mockPublicDns();
    global.fetch
      .mockResolvedValueOnce(makeResponse({
        status: 302,
        headers: {Location: 'https://attacker.example.test/bounce'}
      }))
      .mockResolvedValueOnce(makeResponse({
        status: 302,
        headers: {Location: 'https://psirt.example.test/back'}
      }))
      .mockResolvedValueOnce(makeResponse({
        status: 200,
        headers: {'content-type': 'text/plain'},
        body: 'ok'
      }));

    await httpCall('GET', 'https://psirt.example.test/svc/api/eacg/cases', {
      headers: {'x-api-key': KEY},
      validateEgress: true
    });

    expect(global.fetch).toHaveBeenCalledTimes(3);
    // Hop 0 (origin) carries it.
    expect(global.fetch.mock.calls[0][1].headers['x-api-key']).toBe(KEY);
    // Hop 1 (attacker) and hop 2 (back home) must not.
    [1, 2].forEach((hop) => {
      const headers = global.fetch.mock.calls[hop][1].headers;
      expect(Object.keys(headers).map((k) => k.toLowerCase())).not.toContain('x-api-key');
      expect(Object.values(headers)).not.toContain(KEY);
    });
  });

  it('keeps the credential across a same-origin hop and drops it on the NEXT, cross-origin one', async () => {
    // Both directions in a single chain: the strip is not "always on" (hop 1 keeps
    // it) and not "only the first hop" (hop 2 loses it).
    mockPublicDns();
    global.fetch
      .mockResolvedValueOnce(makeResponse({status: 302, headers: {Location: '/moved'}}))
      .mockResolvedValueOnce(makeResponse({
        status: 302,
        headers: {Location: 'https://attacker.example.test/steal'}
      }))
      .mockResolvedValueOnce(makeResponse({
        status: 200,
        headers: {'content-type': 'text/plain'},
        body: 'ok'
      }));

    await httpCall('GET', 'https://psirt.example.test/svc/api/eacg/cases', {
      headers: {'x-api-key': KEY},
      validateEgress: true
    });

    expect(global.fetch).toHaveBeenCalledTimes(3);
    expect(global.fetch.mock.calls[1][1].headers['x-api-key']).toBe(KEY);
    expect(global.fetch.mock.calls[2][1].headers['x-api-key']).toBeUndefined();
  });

  it('treats an https -> http downgrade on the SAME hostname as cross-origin', async () => {
    // Same host, different scheme. Carrying the key here would put a live
    // credential on the wire in clear text.
    dns.lookup.mockResolvedValue([{address: '93.184.216.34', family: 4}]);
    global.fetch
      .mockResolvedValueOnce(makeResponse({
        status: 302,
        headers: {Location: 'http://psirt.example.test/downgraded'}
      }))
      .mockResolvedValueOnce(makeResponse({status: 200, headers: {'content-type': 'text/plain'}, body: 'ok'}));

    await httpCall('GET', 'https://psirt.example.test/svc/api/eacg/cases', {
      headers: {'x-api-key': KEY},
      validateEgress: true
    });

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(global.fetch.mock.calls[1][0]).toBe('http://psirt.example.test/downgraded');
    expect(global.fetch.mock.calls[1][1].headers['x-api-key']).toBeUndefined();
  });

  it('treats a PORT change on the same hostname as cross-origin', async () => {
    // A different port is a different service; the CVD key is scoped to the one
    // we addressed.
    dns.lookup.mockResolvedValue([{address: '93.184.216.34', family: 4}]);
    global.fetch
      .mockResolvedValueOnce(makeResponse({
        status: 302,
        headers: {Location: 'https://psirt.example.test:8443/other'}
      }))
      .mockResolvedValueOnce(makeResponse({status: 200, headers: {'content-type': 'text/plain'}, body: 'ok'}));

    await httpCall('GET', 'https://psirt.example.test/svc/api/eacg/cases', {
      headers: {'x-api-key': KEY},
      validateEgress: true
    });

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(global.fetch.mock.calls[1][1].headers['x-api-key']).toBeUndefined();
  });

  it("matches X-Api-Key case-insensitively in the app's own casing", async () => {
    mockPublicDns();
    global.fetch
      .mockResolvedValueOnce(makeResponse({
        status: 302,
        headers: {Location: 'https://attacker.example.test/steal'}
      }))
      .mockResolvedValueOnce(makeResponse({status: 200, headers: {'content-type': 'text/plain'}, body: 'ok'}));

    await httpCall('GET', 'https://psirt.example.test/svc/api/eacg/cases', {
      headers: {'X-Api-Key': KEY},
      validateEgress: true
    });

    const crossHopHeaders = global.fetch.mock.calls[1][1].headers;
    expect(Object.keys(crossHopHeaders).map((k) => k.toLowerCase())).not.toContain('x-api-key');
    expect(Object.values(crossHopHeaders)).not.toContain(KEY);
  });

  it('KEEPS x-provisioning-key on a SAME-origin redirect hop (the strip is not blanket)', async () => {
    // The other direction of the provisioning-header test above. If the header
    // list ever became an unconditional drop, provisioning against an upstream
    // that answers its own 302 would break with a confusing 403 and no test
    // would notice.
    const secret = 'provisioning-secret-value';
    dns.lookup.mockResolvedValue([{address: '93.184.216.34', family: 4}]);
    global.fetch
      .mockResolvedValueOnce(makeResponse({status: 307, headers: {Location: '/svc/api/eacg/service-keys/'}}))
      .mockResolvedValueOnce(makeResponse({
        status: 200,
        headers: {'content-type': 'application/json'},
        body: '{"api_key":"k"}'
      }));

    await httpCall('POST', 'https://psirt.example.test/svc/api/eacg/service-keys', {
      headers: {'Content-Type': 'application/json', 'x-provisioning-key': secret},
      data: {company_id: 'ts-app'},
      validateEgress: true
    });

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(global.fetch.mock.calls[1][1].headers['x-provisioning-key']).toBe(secret);
  });

  it("never mutates the CALLER's headers object while stripping", async () => {
    // stripCredentialHeaders returns a copy; httpCall clones the caller's object
    // before that. A regression to in-place deletion would silently disarm the
    // credential for every LATER call that reuses the same headers object.
    mockPublicDns();
    const callerHeaders = {'x-api-key': KEY, 'Content-Type': 'application/json'};
    global.fetch
      .mockResolvedValueOnce(makeResponse({
        status: 302,
        headers: {Location: 'https://attacker.example.test/steal'}
      }))
      .mockResolvedValueOnce(makeResponse({status: 200, headers: {'content-type': 'text/plain'}, body: 'ok'}));

    await httpCall('GET', 'https://psirt.example.test/svc/api/eacg/cases', {
      headers: callerHeaders,
      validateEgress: true
    });

    expect(callerHeaders).toEqual({'x-api-key': KEY, 'Content-Type': 'application/json'});
  });
});

// ---------------------------------------------------------------------------
// REDIRECT METHOD / BODY DOWNGRADE (security fix round).
//
// The credential strip above removes the KEY from a cross-origin hop. Nothing
// removed the BODY. fetchWithEgressGuard built every hop from the same
// baseFetchOptions, which carries `method` and `body`, and only ever rewrote
// headers/redirect - so a 302 naming an attacker host got the original POST body
// re-sent to it verbatim. For the CVD external-intake that body is
// pre-disclosure vulnerability text (product, description, cve_id), and
// assertSafeEgressUrl does not help: it blocks INTERNAL destinations, and an
// attacker's host is public.
//
// WHATWG HTTP-redirect-fetch step 11 is the rule the manual loop has to
// replicate: 301/302/303 re-issue a body-bearing request as a bodyless GET and
// drop the entity headers that described the body. 307/308 exist precisely to
// preserve method and body, so they must be left alone.
//
// If one of these flips, the loop regressed - fix the loop, do NOT relax the test.
// ---------------------------------------------------------------------------
describe('httpCall - validateEgress downgrades the method and drops the body on 301/302/303', () => {
  // The real CVD intake body: pre-disclosure vulnerability detail. It must never
  // reach a redirect target.
  const INTAKE = {
    source: 'trustsource',
    external_case_ref: 'ts-app-Kj4c8pQr2NwT9zLmb',
    product: 'acme-lib',
    description: 'unauthenticated heap overflow, embargoed',
    cve_id: 'CVE-2024-0001'
  };

  function mockPublicDns() {
    dns.lookup.mockImplementation(async (host) => {
      if (host === 'psirt.example.test') return [{address: '93.184.216.34', family: 4}];
      if (host === 'attacker.example.test') return [{address: '198.51.100.7', family: 4}];
      throw new Error('unexpected host ' + host);
    });
  }

  function redirectThenOk(status, location) {
    global.fetch
      .mockResolvedValueOnce(makeResponse({status, headers: {Location: location}}))
      .mockResolvedValueOnce(makeResponse({
        status: 200,
        headers: {'content-type': 'application/json'},
        body: '{"ok":1}'
      }));
  }

  it.each([301, 302, 303])(
    're-issues a POST as a bodyless GET on %i, so the intake body never reaches the redirect target',
    async (status) => {
      mockPublicDns();
      redirectThenOk(status, 'https://attacker.example.test/steal');

      await httpCall('POST', 'https://psirt.example.test/svc/api/eacg/cases/external-intake', {
        headers: {'x-api-key': 'company-api-key-value'},
        data: INTAKE,
        validateEgress: true
      });

      expect(global.fetch).toHaveBeenCalledTimes(2);
      // Hop 0 is the real request.
      expect(global.fetch.mock.calls[0][1].method).toBe('POST');
      expect(global.fetch.mock.calls[0][1].body).toBe(JSON.stringify(INTAKE));
      // Hop 1 must be a bodyless GET.
      const hop = global.fetch.mock.calls[1][1];
      expect(hop.method).toBe('GET');
      expect(hop.body).toBeUndefined();
      // Belt and braces: no fragment of the embargoed text survives anywhere in
      // the options handed to fetch.
      expect(JSON.stringify(hop)).not.toContain('embargoed');
      expect(JSON.stringify(hop)).not.toContain('CVE-2024-0001');
    }
  );

  // All five request-body-header names from the WHATWG list, not just the two
  // this app happens to set. Native fetch deletes the whole set on a downgrade;
  // leaving three of them behind advertises a payload the bodyless GET no longer
  // carries.
  const ENTITY_HEADER_NAMES = [
    'content-type',
    'content-length',
    'content-encoding',
    'content-language',
    'content-location'
  ];

  it('drops ALL five body-describing entity headers on the downgraded hop', async () => {
    mockPublicDns();
    redirectThenOk(302, 'https://attacker.example.test/steal');

    await httpCall('POST', 'https://psirt.example.test/svc/api/eacg/cases/external-intake', {
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': '128',
        'Content-Encoding': 'gzip',
        'Content-Language': 'en',
        'Content-Location': '/svc/api/eacg/cases/external-intake'
      },
      data: INTAKE,
      validateEgress: true
    });

    const hopKeys = Object.keys(global.fetch.mock.calls[1][1].headers).map((k) => k.toLowerCase());
    ENTITY_HEADER_NAMES.forEach((name) => expect(hopKeys).not.toContain(name));
    // The first hop still carried them all - the drop is scoped to the downgrade.
    const firstKeys = Object.keys(global.fetch.mock.calls[0][1].headers).map((k) => k.toLowerCase());
    ENTITY_HEADER_NAMES.forEach((name) => expect(firstKeys).toContain(name));
  });

  it.each([307, 308])('PRESERVES method, body and Content-Type on %i (that is what 307/308 mean)', async (status) => {
    mockPublicDns();
    redirectThenOk(status, 'https://psirt.example.test/svc/api/eacg/cases/external-intake/');

    await httpCall('POST', 'https://psirt.example.test/svc/api/eacg/cases/external-intake', {
      headers: {'Content-Type': 'application/json'},
      data: INTAKE,
      validateEgress: true
    });

    const hop = global.fetch.mock.calls[1][1];
    expect(hop.method).toBe('POST');
    expect(hop.body).toBe(JSON.stringify(INTAKE));
    expect(hop.headers['Content-Type']).toBe('application/json');
  });

  it('downgrades on a SAME-ORIGIN 302 as well - the body is not re-sent to anyone', async () => {
    // The credential strip is origin-scoped; the body downgrade is not. A
    // same-origin 302 answering a POST still means "look over there with a GET".
    dns.lookup.mockResolvedValue([{address: '93.184.216.34', family: 4}]);
    redirectThenOk(302, '/svc/api/eacg/cases/moved');

    await httpCall('POST', 'https://psirt.example.test/svc/api/eacg/cases/external-intake', {
      headers: {'Content-Type': 'application/json', 'x-api-key': 'company-api-key-value'},
      data: INTAKE,
      validateEgress: true
    });

    const hop = global.fetch.mock.calls[1][1];
    expect(hop.method).toBe('GET');
    expect(hop.body).toBeUndefined();
    // ...while the credential still travels, because the origin did not change.
    expect(hop.headers['x-api-key']).toBe('company-api-key-value');
  });

  it('leaves a GET a GET on a 303 and never invents a body', async () => {
    dns.lookup.mockResolvedValue([{address: '93.184.216.34', family: 4}]);
    redirectThenOk(303, '/elsewhere');

    await httpCall('GET', 'https://psirt.example.test/svc/api/eacg/cases', {validateEgress: true});

    expect(global.fetch.mock.calls[1][1].method).toBe('GET');
    expect(global.fetch.mock.calls[1][1].body).toBeUndefined();
  });

  it('once downgraded, a later 307 in the same chain does NOT resurrect the body OR its entity headers', async () => {
    // 302 (downgrade to GET) -> 307 (preserve). "Preserve" must preserve the
    // CURRENT method/body/headers, not the ones the caller originally supplied.
    //
    // The entity-header half is what a hop-headers refactor gets wrong: rebuilding
    // each hop's headers from the ORIGINAL base restores method/body correctly
    // (they are tracked separately) while quietly re-attaching Content-Type and
    // Content-Length to a request that now has no body at all. Asserting the
    // method and body alone does not catch that, so both hops are checked for the
    // full entity-header set here too.
    mockPublicDns();
    global.fetch
      .mockResolvedValueOnce(makeResponse({status: 302, headers: {Location: '/moved'}}))
      .mockResolvedValueOnce(makeResponse({status: 307, headers: {Location: '/moved-again'}}))
      .mockResolvedValueOnce(makeResponse({
        status: 200,
        headers: {'content-type': 'application/json'},
        body: '{"ok":1}'
      }));

    await httpCall('POST', 'https://psirt.example.test/svc/api/eacg/cases/external-intake', {
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': '128',
        'Content-Encoding': 'gzip',
        'Content-Language': 'en',
        'Content-Location': '/svc/api/eacg/cases/external-intake',
        Accept: 'application/json'
      },
      data: INTAKE,
      validateEgress: true
    });

    expect(global.fetch).toHaveBeenCalledTimes(3);
    [1, 2].forEach((hop) => {
      const opts = global.fetch.mock.calls[hop][1];
      expect(opts.method).toBe('GET');
      expect(opts.body).toBeUndefined();
      const keys = Object.keys(opts.headers).map((k) => k.toLowerCase());
      ENTITY_HEADER_NAMES.forEach((name) => expect(keys).not.toContain(name));
      // ...while a non-entity header is still carried, so this is proving the
      // entity headers STAYED dropped, not that the headers were blanket-cleared.
      expect(opts.headers.Accept).toBe('application/json');
    });
  });

  it("never mutates the CALLER's options while downgrading", async () => {
    // Same discipline as the header clone: httpCall builds its own options object
    // and the loop must not write `method`/`body` back into it, or a retry that
    // reuses the object would silently send a GET.
    mockPublicDns();
    redirectThenOk(302, 'https://attacker.example.test/steal');
    const callerHeaders = {'Content-Type': 'application/json', 'x-api-key': 'k'};

    await httpCall('POST', 'https://psirt.example.test/svc/api/eacg/cases/external-intake', {
      headers: callerHeaders,
      data: INTAKE,
      validateEgress: true
    });

    expect(callerHeaders).toEqual({'Content-Type': 'application/json', 'x-api-key': 'k'});
  });
});

// ---------------------------------------------------------------------------
// STEP 11 IS NARROWER THAN "ANY BODY-BEARING METHOD" (second fix round).
//
// The first cut of downgradesToGet rewrote 301/302/303 for every method that was
// not GET/HEAD. WHATWG HTTP-redirect-fetch step 11 - and Node's own fetch,
// verified against a loopback server - only rewrites:
//   301/302 when the method is POST;
//   303     for anything but HEAD.
// So DELETE/PUT/PATCH survive a 301/302 unchanged.
//
// This is not cosmetic. imports/startup/server/jira.js:86 issues
// httpCall('DELETE', url + 'issue/' + key, options) with validateEgress:true
// against a USER-SUPPLIED Jira base URL. A host that canonicalises (trailing
// slash, www., http->https) answers that DELETE with a 301/302. Rewriting it to
// GET turns a state-changing call into a read that returns 200 + the issue JSON,
// which jiraRemoveIssue hands back to the caller AS SUCCESS while the issue is
// still there. Silent data-integrity failure, no error anywhere.
//
// If one of these flips, the loop over-reached again - fix the loop, do NOT relax
// the test.
// ---------------------------------------------------------------------------
describe('httpCall - validateEgress preserves non-POST methods across 301/302', () => {
  const PAYLOAD = {fields: {summary: 'still a real write'}};

  function redirectThenOk(status, location) {
    global.fetch
      .mockResolvedValueOnce(makeResponse({status, headers: {Location: location}}))
      .mockResolvedValueOnce(makeResponse({
        status: 200,
        headers: {'content-type': 'application/json'},
        body: '{"ok":1}'
      }));
  }

  it.each([
    [301, 'DELETE'],
    [301, 'PUT'],
    [301, 'PATCH'],
    [302, 'DELETE'],
    [302, 'PUT'],
    [302, 'PATCH']
  ])('re-issues a %i answering a %s as the SAME method, body and entity headers intact', async (status, method) => {
    dns.lookup.mockResolvedValue([{address: '93.184.216.34', family: 4}]);
    redirectThenOk(status, '/rest/api/2/issue/X/');

    await httpCall(method, 'https://jira.example.test/rest/api/2/issue/X', {
      headers: {'Content-Type': 'application/json'},
      data: PAYLOAD,
      validateEgress: true
    });

    expect(global.fetch).toHaveBeenCalledTimes(2);
    const hop = global.fetch.mock.calls[1][1];
    expect(hop.method).toBe(method);
    expect(hop.body).toBe(JSON.stringify(PAYLOAD));
    expect(hop.headers['Content-Type']).toBe('application/json');
  });

  it.each([301, 302])(
    'a bodyless DELETE across a canonicalising %i is still a DELETE (jiraRemoveIssue really deletes)',
    async (status) => {
      // The exact jira.js:86 shape: no `data`, so no body - only the method
      // matters, and it is the only thing that makes the call destructive.
      dns.lookup.mockResolvedValue([{address: '93.184.216.34', family: 4}]);
      redirectThenOk(status, 'https://jira.example.test/rest/api/2/issue/X/');

      await httpCall('DELETE', 'https://jira.example.test/rest/api/2/issue/X', {
        headers: {'Content-Type': 'application/json'},
        auth: 'tenant:secret',
        validateEgress: true
      });

      expect(global.fetch.mock.calls[1][1].method).toBe('DELETE');
    }
  );

  it.each(['DELETE', 'PUT', 'PATCH'])('still downgrades a %s to a bodyless GET on a 303', async (method) => {
    // 303 means "the answer is elsewhere, go GET it" for everything but HEAD, so
    // the narrowing above must not have relaxed 303 as well.
    dns.lookup.mockResolvedValue([{address: '93.184.216.34', family: 4}]);
    redirectThenOk(303, '/rest/api/2/issue/X/result');

    await httpCall(method, 'https://jira.example.test/rest/api/2/issue/X', {
      headers: {'Content-Type': 'application/json'},
      data: PAYLOAD,
      validateEgress: true
    });

    const hop = global.fetch.mock.calls[1][1];
    expect(hop.method).toBe('GET');
    expect(hop.body).toBeUndefined();
    expect(Object.keys(hop.headers).map((k) => k.toLowerCase())).not.toContain('content-type');
  });

  it('leaves a HEAD a HEAD on a 303', async () => {
    dns.lookup.mockResolvedValue([{address: '93.184.216.34', family: 4}]);
    redirectThenOk(303, '/elsewhere');

    await httpCall('HEAD', 'https://jira.example.test/rest/api/2/issue/X', {validateEgress: true});

    expect(global.fetch.mock.calls[1][1].method).toBe('HEAD');
    expect(global.fetch.mock.calls[1][1].body).toBeUndefined();
  });

  it('still rewrites a POST to a bodyless GET on a 301 and a 302 (the narrowing kept the POST rule)', async () => {
    for (const status of [301, 302]) {
      global.fetch.mockReset();
      dns.lookup.mockResolvedValue([{address: '93.184.216.34', family: 4}]);
      redirectThenOk(status, 'https://jira.example.test/moved');

      await httpCall('POST', 'https://jira.example.test/rest/api/2/issue/', {
        headers: {'Content-Type': 'application/json'},
        data: PAYLOAD,
        validateEgress: true
      });

      expect(global.fetch.mock.calls[1][1].method).toBe('GET');
      expect(global.fetch.mock.calls[1][1].body).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// redirect:'manual' IS THE LOAD-BEARING OPTION (second fix round).
//
// Everything above - the credential strip, the method/body downgrade, the
// per-hop re-validation - only runs because the 3xx comes back TO US. Delete
// `redirect: 'manual'` from fetchWithEgressGuard and native fetch follows the
// chain itself, delivering x-api-key / x-provisioning-key AND the pre-disclosure
// intake body to the redirect target before a line of guard code executes; the
// loop then sees only the final 200 and every other assertion in this file stays
// green. The mock ignores the option, so nothing else can catch it.
//
// The flag-OFF branch already has the negative assertion (redirect must be
// undefined); this is the positive one for the guarded branch, on the first hop
// and on a later hop - deleting it from either path must go red.
// ---------------------------------------------------------------------------
describe("httpCall - validateEgress pins redirect:'manual' on every hop", () => {
  it("sets redirect:'manual' on the FIRST hop and on every SUBSEQUENT hop", async () => {
    dns.lookup.mockResolvedValue([{address: '93.184.216.34', family: 4}]);
    global.fetch
      .mockResolvedValueOnce(makeResponse({status: 302, headers: {Location: '/one'}}))
      .mockResolvedValueOnce(makeResponse({status: 307, headers: {Location: '/two'}}))
      .mockResolvedValueOnce(makeResponse({
        status: 200,
        headers: {'content-type': 'application/json'},
        body: '{"ok":1}'
      }));

    await httpCall('POST', 'https://psirt.example.test/svc/api/eacg/cases/external-intake', {
      headers: {'x-api-key': 'company-api-key-value'},
      data: {product: 'acme-lib', description: 'embargoed'},
      validateEgress: true
    });

    expect(global.fetch).toHaveBeenCalledTimes(3);
    [0, 1, 2].forEach((hop) => {
      expect(global.fetch.mock.calls[hop][1].redirect).toBe('manual');
    });
  });

  it("sets redirect:'manual' even on a single-hop call that never redirects", async () => {
    // The option has to be on the request BEFORE we know whether it will be
    // answered with a 3xx - that is the whole point.
    dns.lookup.mockResolvedValue([{address: '93.184.216.34', family: 4}]);
    global.fetch.mockResolvedValueOnce(makeResponse({
      status: 200,
      headers: {'content-type': 'application/json'},
      body: '{"ok":1}'
    }));

    await httpCall('GET', 'https://psirt.example.test/svc/api/eacg/cases', {validateEgress: true});

    expect(global.fetch.mock.calls[0][1].redirect).toBe('manual');
  });
});

describe('assertSafeEgressUrl - suffix / userinfo / encoding bypasses at the egress layer', () => {
  it('blocks a `#`-suffixed internal literal at egress (no DNS, no fetch reach)', async () => {
    await expect(assertSafeEgressUrl('http://169.254.169.254/x#'))
      .rejects.toMatchObject({code: 'SSRF_BLOCKED'});
    expect(dns.lookup).not.toHaveBeenCalled();
  });

  it('blocks a `?`-suffixed internal literal at egress', async () => {
    await expect(assertSafeEgressUrl('http://169.254.169.254/x?ignored=1'))
      .rejects.toMatchObject({code: 'SSRF_BLOCKED'});
  });

  it('judges userinfo-confusion (user@host) on the REAL host, not the userinfo', async () => {
    // The authority host is 169.254.169.254 / 10.0.0.1; the leading "expected.com@"
    // is userinfo and must NOT fool the gate.
    await expect(assertSafeEgressUrl('http://expected.com@169.254.169.254/'))
      .rejects.toMatchObject({code: 'SSRF_BLOCKED'});
    await expect(assertSafeEgressUrl('http://expected.com@10.0.0.1/'))
      .rejects.toMatchObject({code: 'SSRF_BLOCKED'});
    expect(dns.lookup).not.toHaveBeenCalled();
  });

  it('blocks an uppercase/mixed-case hex literal (0X7F000001 == 127.0.0.1)', async () => {
    await expect(assertSafeEgressUrl('http://0X7F000001/'))
      .rejects.toMatchObject({code: 'SSRF_BLOCKED'});
  });
});

describe('assertSafeEgressUrl - bracketed IPv6 literals', () => {
  it('blocks bracketed IPv6 loopback / ULA / link-local literals', async () => {
    await expect(assertSafeEgressUrl('http://[::1]/'))
      .rejects.toMatchObject({code: 'SSRF_BLOCKED'});
    await expect(assertSafeEgressUrl('http://[fc00::1]/'))
      .rejects.toMatchObject({code: 'SSRF_BLOCKED'});
    await expect(assertSafeEgressUrl('http://[fe80::1]/'))
      .rejects.toMatchObject({code: 'SSRF_BLOCKED'});
    expect(dns.lookup).not.toHaveBeenCalled();
  });

  it('blocks a bracketed IPv4-mapped IPv6 wrapping an internal v4', async () => {
    await expect(assertSafeEgressUrl('http://[::ffff:10.0.0.1]/'))
      .rejects.toMatchObject({code: 'SSRF_BLOCKED'});
    await expect(assertSafeEgressUrl('http://[::ffff:169.254.169.254]/'))
      .rejects.toMatchObject({code: 'SSRF_BLOCKED'});
  });
});

describe('httpCall - flag OFF: redirect-bearing internal call is untouched (no DNS)', () => {
  it('follows fetch-native redirects and never engages the egress DNS guard', async () => {
    // With the flag off, redirect:'manual' is NOT set and assertSafeEgressUrl is
    // never invoked - the trusted-caller path is byte-for-byte the old behavior.
    global.fetch.mockResolvedValueOnce(makeResponse({
      status: 200,
      headers: {'content-type': 'application/json'},
      body: '{"internal":true}'
    }));
    const res = await httpCall('GET', 'http://10.0.0.5/internal');
    expect(global.fetch).toHaveBeenCalledTimes(1);
    // No redirect:'manual' override, no SSRF validation, no DNS lookup.
    expect(global.fetch.mock.calls[0][1].redirect).toBeUndefined();
    expect(dns.lookup).not.toHaveBeenCalled();
    expect(res.data).toEqual({internal: true});
  });

  // Pins the SCOPE the CREDENTIAL_HEADERS comment claims: the list is consulted
  // only from stripCredentialHeaders, which only fetchWithEgressGuard reaches,
  // which only a validateEgress:true caller reaches. Any other integration
  // that sends x-api-key is on this branch and gains nothing from it - so the header must go out untouched here. A
  // refactor that promoted the strip to httpCall itself would change behaviour
  // for all of them; this is what would catch it.
  it('does NOT strip x-api-key on the trusted branch (the credential list is scoped to validateEgress)', async () => {
    global.fetch.mockResolvedValueOnce(makeResponse({
      status: 200,
      headers: {'content-type': 'application/json'},
      body: '{}'
    }));

    await httpCall('GET', 'https://deepscan.example.test/api/scans', {
      headers: {'x-api-key': 'deepscan-key'}
    });

    expect(global.fetch.mock.calls[0][1].headers['x-api-key']).toBe('deepscan-key');
    expect(dns.lookup).not.toHaveBeenCalled();
  });
});

describe('assertSafeEgressUrl - error never leaks an SSRF oracle', () => {
  it('rejection carries no resolved IP and no response body', async () => {
    dns.lookup.mockResolvedValue([{address: '169.254.169.254', family: 4}]);
    let err;
    try {
      await assertSafeEgressUrl('https://rebind.attacker.test/secret-path');
    } catch (e) {
      err = e;
    }
    expect(err.code).toBe('SSRF_BLOCKED');
    expect(err.message).not.toMatch(/169\.254\.169\.254/);
    expect(err.message).not.toMatch(/rebind\.attacker\.test/);
    expect(err.message).not.toMatch(/secret-path/);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// REGRESSION GUARD - IPv4-mapped IPv6 in hex-grouped form (previously a bypass).
//
// The egress gate must refuse an internal address regardless of the textual
// form a (malicious / rebinding) resolver returns it in. dns.lookup CAN return
// an IPv4-mapped address in canonical hex-grouped IPv6 form (the form Node's
// getaddrinfo emits for a mapped AAAA record): `::ffff:a9fe:a9fe` is
// 169.254.169.254 (cloud metadata); `::ffff:a00:1` is 10.0.0.1. Earlier the
// classifier only unwrapped the SHORT DOTTED form `::ffff:a.b.c.d`, so these
// slipped through. ssrfGuard.js now unwraps any net.isIP===6 value via its 16
// binary bytes, so the request to the internal/metadata target is blocked.
//
// These two cases lock the fix in. Do NOT relax them to go green.
// ---------------------------------------------------------------------------
describe('assertSafeEgressUrl - IPv4-mapped IPv6 in hex-grouped form is blocked', () => {
  it('MUST block a host that resolves to ::ffff:a9fe:a9fe (= 169.254.169.254 metadata)', async () => {
    dns.lookup.mockResolvedValue([{address: '::ffff:a9fe:a9fe', family: 6}]);
    await expect(assertSafeEgressUrl('https://rebind.attacker.test/'))
      .rejects.toMatchObject({code: 'SSRF_BLOCKED'});
  });

  it('MUST block a host that resolves to ::ffff:a00:1 (= 10.0.0.1 internal)', async () => {
    dns.lookup.mockResolvedValue([{address: '::ffff:a00:1', family: 6}]);
    await expect(assertSafeEgressUrl('https://rebind2.attacker.test/'))
      .rejects.toMatchObject({code: 'SSRF_BLOCKED'});
  });
});
