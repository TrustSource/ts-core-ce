/* eslint-disable no-undef */
// SSRF input-validation tests for assertSafePublicUrl + normalizeHost +
// isBlockedIp (imports/lib/security/ssrfGuard.js).
//
// assertSafePublicUrl is the SYNC save-time gate wired into the integration
// interactors (Jira/TFS settings, webhooks). It must reject any URL whose
// LITERAL host is an internal/private/metadata address, any non-http(s)
// scheme, any host-less authority, and - crucially - every alternate IP
// encoding (hex / octal / 32-bit decimal / short form), since those collapse
// to internal addresses once the OS parses them. Hostnames are NOT resolved
// here (DNS-rebinding is caught at egress) so a public hostname is accepted.
//
// SECURITY NOTE: each "rejects" assertion below is a real SSRF bypass class.
// If one flips to passing, the save-time gate regressed - fix the guard, do
// NOT relax the test. The thrown error must carry code 400 and must NOT echo
// the resolved/parsed IP (no SSRF oracle).
const {
  assertSafePublicUrl,
  normalizeHost,
  isBlockedIp,
  BLOCKED_REASON
} = require('../../imports/lib/security/ssrfGuard');

function expectReject(url) {
  expect(() => assertSafePublicUrl(url)).toThrow();
}

describe('assertSafePublicUrl - scheme allow-list', () => {
  it('rejects non-http(s) schemes', () => {
    expectReject('ftp://acme.atlassian.net/');
    expectReject('file:///etc/passwd');
    expectReject('gopher://10.0.0.1/');
    expectReject('data:text/plain,hi');
    expectReject('javascript:alert(1)');
  });

  it('rejects scheme-relative and scheme-less inputs', () => {
    expectReject('//acme.atlassian.net/');
    expectReject('acme.atlassian.net/path');
    expectReject('10.0.0.1');
  });

  it('rejects empty / non-string input', () => {
    expectReject('');
    expectReject('   ');
    expect(() => assertSafePublicUrl(null)).toThrow();
    expect(() => assertSafePublicUrl(undefined)).toThrow();
    expect(() => assertSafePublicUrl(12345)).toThrow();
    expect(() => assertSafePublicUrl({})).toThrow();
  });

  it('rejects a URL with no host', () => {
    // Genuinely host-less authorities (WHATWG throws on these).
    expectReject('http://');
    expectReject('https://');
  });
});

describe('assertSafePublicUrl - literal private / loopback / link-local IPv4', () => {
  it('rejects loopback 127/8', () => {
    expectReject('http://127.0.0.1/');
    expectReject('https://127.1.2.3/path');
  });

  it('rejects RFC-1918 ranges', () => {
    expectReject('http://10.0.0.1/');
    expectReject('http://10.255.255.255/');
    expectReject('http://172.16.0.1/');
    expectReject('http://172.31.255.255/');
    expectReject('http://192.168.0.1/');
    expectReject('http://192.168.1.1/');
  });

  it('rejects link-local 169.254/16 incl. cloud-metadata IPs', () => {
    expectReject('http://169.254.169.254/latest/meta-data/'); // AWS/GCP metadata
    expectReject('http://169.254.170.2/v2/credentials/');      // ECS task metadata
    expectReject('http://169.254.0.1/');
  });

  it('rejects CGNAT 100.64/10 and 0.0.0.0/8', () => {
    expectReject('http://100.64.0.1/');
    expectReject('http://100.127.255.255/');
    expectReject('http://0.0.0.0/');
    expectReject('http://0.1.2.3/');
  });
});

describe('assertSafePublicUrl - literal private / loopback IPv6', () => {
  it('rejects IPv6 loopback / ULA / link-local', () => {
    expectReject('http://[::1]/');
    expectReject('http://[fc00::1]/');
    expectReject('http://[fd00::1]/');
    expectReject('http://[fe80::1]/');
  });

  it('rejects an IPv4-mapped IPv6 wrapping an internal v4', () => {
    expectReject('http://[::ffff:10.0.0.1]/');
    expectReject('http://[::ffff:127.0.0.1]/');
    expectReject('http://[::ffff:169.254.169.254]/');
  });

  it('rejects internal bracketed IPv6 literals via the classifier (brackets retained by URL.hostname on Node 22/24)', () => {
    // Regression for the stale "URL.hostname strips brackets" assumption: the
    // bracketed literal must reach the IPv6 classifier, not the null/reject
    // branch. Internal v6 literals stay rejected.
    expectReject('http://[::1]/');
    expectReject('http://[fc00::1]/');
  });

  it('accepts a public bracketed IPv6 literal (now reaches the classifier)', () => {
    // Previously these fell to the reject branch (brackets retained); they must
    // now be accepted because the v6 classifier engages and the address is
    // public.
    expect(() => assertSafePublicUrl('http://[2001:4860:4860::8888]/')).not.toThrow();
    const u = assertSafePublicUrl('https://[2606:4700:4700::1111]/dns-query');
    expect(u).toBeTruthy();
  });
});

describe('assertSafePublicUrl - encoded / obfuscated IP bypasses', () => {
  it('rejects hex-encoded IPv4', () => {
    expectReject('http://0x7f000001/');         // 127.0.0.1
    expectReject('http://0xA.0.0.1/');
  });

  it('rejects octal (leading-zero) IPv4', () => {
    expectReject('http://0177.0.0.1/');         // 127.0.0.1
    expectReject('http://012.0.0.1/');
  });

  it('rejects 32-bit decimal IPv4', () => {
    expectReject('http://2130706433/');         // 127.0.0.1
    expectReject('http://167772161/');          // 10.0.0.1
  });

  it('rejects short-form IPv4', () => {
    expectReject('http://127.1/');
    expectReject('http://10.1/');
    expectReject('http://192.168.1/');
  });

  it('rejects overlong / out-of-range octets', () => {
    expectReject('http://10.0.0.256/');
    expectReject('http://256.1.1.1/');
    expectReject('http://10.0.0.0.1/');
  });
});

describe('assertSafePublicUrl - fragment / query cannot smuggle an internal authority', () => {
  it('the # / ? suffix does not change the authority that is validated', () => {
    // A public host stays accepted regardless of a #/? carrying an internal
    // string; the authority is parsed by WHATWG URL, not by string-splitting.
    expect(() => assertSafePublicUrl('https://acme.atlassian.net/#@127.0.0.1/')).not.toThrow();
    expect(() => assertSafePublicUrl('https://acme.atlassian.net/?next=http://10.0.0.1/')).not.toThrow();
    // And an internal host is still rejected even with a public-looking suffix.
    expectReject('http://127.0.0.1/#acme.atlassian.net');
    expectReject('http://10.0.0.1/?host=acme.atlassian.net');
  });
});

describe('assertSafePublicUrl - accepts legitimate public targets', () => {
  it('accepts a public hostname (DNS not resolved here)', () => {
    const u = assertSafePublicUrl('https://acme.atlassian.net/rest/api/2/');
    expect(u).toBeTruthy();
    expect(u.hostname).toBe('acme.atlassian.net');
  });

  it('accepts a public literal IP', () => {
    expect(() => assertSafePublicUrl('https://8.8.8.8/')).not.toThrow();
    expect(() => assertSafePublicUrl('http://1.1.1.1/')).not.toThrow();
  });
});

describe('assertSafePublicUrl - error shape (no SSRF oracle)', () => {
  it('throws an error with code 400 and a generic message', () => {
    let err;
    try {
      assertSafePublicUrl('http://169.254.169.254/');
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe(400);
    expect(err.message).toBe(BLOCKED_REASON);
  });

  it('error message never echoes the resolved/parsed IP', () => {
    let err;
    try {
      assertSafePublicUrl('http://0x7f000001/');
    } catch (e) {
      err = e;
    }
    expect(err.message).not.toMatch(/127\.0\.0\.1/);
    expect(err.message).not.toMatch(/0x7f000001/);
    expect(err.message).toBe(BLOCKED_REASON);
  });
});

describe('normalizeHost - canonical hostname or canonical IP only', () => {
  it('returns canonical dotted-quad IPv4 unchanged', () => {
    expect(normalizeHost('10.0.0.1')).toBe('10.0.0.1');
    expect(normalizeHost('8.8.8.8')).toBe('8.8.8.8');
  });

  it('returns a valid hostname (lowercased by WHATWG already)', () => {
    expect(normalizeHost('acme.atlassian.net')).toBe('acme.atlassian.net');
    expect(normalizeHost('host')).toBe('host');
  });

  it('unwraps an IPv4-mapped IPv6 to dotted-quad v4', () => {
    expect(normalizeHost('::ffff:10.0.0.1')).toBe('10.0.0.1');
    expect(normalizeHost('::ffff:127.0.0.1')).toBe('127.0.0.1');
  });

  it('returns a valid bare IPv6 unchanged', () => {
    expect(normalizeHost('::1')).toBe('::1');
    expect(normalizeHost('fe80::1')).toBe('fe80::1');
  });

  it('returns null for every encoded / malformed IPv4 form', () => {
    expect(normalizeHost('0x7f000001')).toBeNull();
    expect(normalizeHost('0177.0.0.1')).toBeNull();
    expect(normalizeHost('2130706433')).toBeNull();
    expect(normalizeHost('127.1')).toBeNull();
    expect(normalizeHost('10.0.0.256')).toBeNull();
    expect(normalizeHost('10.0.0.0.1')).toBeNull();
    expect(normalizeHost('01.0.0.1')).toBeNull();       // leading-zero octet
    expect(normalizeHost('10.00.0.1')).toBeNull();
  });

  it('returns null for malformed authority junk', () => {
    expect(normalizeHost('')).toBeNull();
    expect(normalizeHost('-bad.com')).toBeNull();
    expect(normalizeHost('bad_host.com')).toBeNull();
    expect(normalizeHost('a..b')).toBeNull();
  });
});

describe('isBlockedIp - integer CIDR classification', () => {
  it('blocks all private / loopback / link-local / CGNAT IPv4', () => {
    expect(isBlockedIp('10.0.0.1')).toBe(true);
    expect(isBlockedIp('172.16.0.1')).toBe(true);
    expect(isBlockedIp('172.31.255.255')).toBe(true);
    expect(isBlockedIp('192.168.1.1')).toBe(true);
    expect(isBlockedIp('169.254.169.254')).toBe(true);
    expect(isBlockedIp('169.254.170.2')).toBe(true);
    expect(isBlockedIp('127.0.0.1')).toBe(true);
    expect(isBlockedIp('100.64.0.1')).toBe(true);
    expect(isBlockedIp('0.0.0.0')).toBe(true);
  });

  it('does NOT block public IPv4 just outside the blocks', () => {
    expect(isBlockedIp('8.8.8.8')).toBe(false);
    expect(isBlockedIp('1.1.1.1')).toBe(false);
    expect(isBlockedIp('172.15.255.255')).toBe(false); // just below 172.16/12
    expect(isBlockedIp('172.32.0.1')).toBe(false);     // just above 172.16/12
    expect(isBlockedIp('192.167.1.1')).toBe(false);
    expect(isBlockedIp('192.169.1.1')).toBe(false);
    expect(isBlockedIp('100.63.255.255')).toBe(false); // just below CGNAT
    expect(isBlockedIp('100.128.0.0')).toBe(false);    // just above CGNAT
    expect(isBlockedIp('1.0.0.1')).toBe(false);
  });

  it('blocks IPv6 loopback / ULA / link-local; unwraps IPv4-mapped', () => {
    expect(isBlockedIp('::1')).toBe(true);
    expect(isBlockedIp('fc00::1')).toBe(true);
    expect(isBlockedIp('fd00::1')).toBe(true);
    expect(isBlockedIp('fe80::1')).toBe(true);
    expect(isBlockedIp('::ffff:10.0.0.1')).toBe(true);
    expect(isBlockedIp('::ffff:127.0.0.1')).toBe(true);
  });

  it('blocks IPv4-mapped IPv6 in canonical HEX-GROUPED form (what dns.lookup emits)', () => {
    // The form Node's resolver returns for a mapped AAAA record. The dotted-only
    // regex missed these; the binary low-32-bits reclassification catches them.
    expect(isBlockedIp('::ffff:a9fe:a9fe')).toBe(true); // 169.254.169.254 metadata
    expect(isBlockedIp('::ffff:a00:1')).toBe(true);     // 10.0.0.1 internal
    expect(isBlockedIp('::ffff:7f00:1')).toBe(true);    // 127.0.0.1 loopback
    expect(isBlockedIp('::ffff:c0a8:1')).toBe(true);    // 192.168.0.1
  });

  it('does NOT block a public IPv4-mapped IPv6 (hex-grouped)', () => {
    expect(isBlockedIp('::ffff:0808:0808')).toBe(false); // 8.8.8.8 public
  });

  it('does NOT block a public IPv6', () => {
    expect(isBlockedIp('2001:4860:4860::8888')).toBe(false);
  });

  it('normalizeHost unwraps hex-grouped IPv4-mapped IPv6 to its dotted-quad v4', () => {
    expect(normalizeHost('::ffff:a9fe:a9fe')).toBe('169.254.169.254');
    expect(normalizeHost('::ffff:a00:1')).toBe('10.0.0.1');
    // Public mapped form unwraps to its public v4 (accepted downstream).
    expect(normalizeHost('::ffff:0808:0808')).toBe('8.8.8.8');
  });
});
