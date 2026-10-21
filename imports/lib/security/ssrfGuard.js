// ssrfGuard - SSRF defenses for user-supplied integration / webhook URLs.
//
// Two independent layers, both exported here:
//
//   assertSafePublicUrl(url)  - SYNC, NO DNS. The save-time input gate wired
//     into the integration interactors (Jira/TFS settings, webhook create).
//     Rejects bad schemes, host-less authorities, and any LITERAL host that is
//     an internal / private / loopback / link-local / metadata address - incl.
//     every alternate IP encoding (hex / octal / 32-bit decimal / short form),
//     which all collapse to internal addresses once the OS parses them. A
//     public *hostname* is accepted here on purpose: it is NOT resolved at save
//     time (DNS can change), so DNS-rebinding is caught at egress instead.
//
//   assertSafeEgressUrl(url)  - ASYNC, DOES DNS. The authoritative egress gate
//     used by httpFetch.js `httpCall` when a caller opts in with
//     `validateEgress: true`. Resolves the host and refuses if ANY resolved
//     address is internal; this is what stops DNS-rebinding, mixed-record
//     attacks, and (re-run per hop) redirect-to-internal.
//
//   TS_ALLOWED_PRIVATE_HOSTS - operator allowlist for a self-hosted install
//     whose Jira, TFS or webhook receivers live on the internal network. A
//     comma-separated list of host names (`jira.corp.local`), domain suffixes
//     (`.corp.local`), IP addresses and CIDR ranges (`10.20.0.0/16`). A listed
//     host name may resolve to internal addresses; a listed IP or range is
//     allowed as a literal or as a resolved address. Cloud metadata addresses
//     stay blocked whatever is listed. Read per call, never cached.
//
// Dependency-free CommonJS (Node built-ins only) so it loads under Jest with a
// plain require and carries no Meteor import - same pattern as sseTrace.js. The
// module stays Meteor-free and throws plain Errors; each interactor call site
// wraps assertSafePublicUrl's throw in a Meteor.Error(400, ...). The generic
// BLOCKED_REASON message and IP-free egress error avoid building an SSRF oracle
// (we never echo the resolved IP, host detail, or response body).

const {URL} = require('node:url');
const net = require('node:net');
const dns = require('node:dns/promises');

// Generic, detail-free rejection message. NEVER interpolate the host/IP.
const BLOCKED_REASON = 'URL is not allowed';

// Strict DNS hostname: labels of [a-z0-9-] (no leading/trailing hyphen on the
// last label), dot-separated, each 1..63 chars. WHATWG URL already lowercases /
// IDNA-encodes the hostname before we see it.
const HOSTNAME_RE = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,62})(\.[a-z0-9]([a-z0-9-]{0,62}))*$/i;

// Canonical dotted-quad IPv4: exactly 4 decimal octets, 0..255, NO leading zero
// (leading zeros are the octal bypass), digits only.
const IPV4_OCTET_RE = /^(0|[1-9]\d{0,2})$/;

/**
 * Normalize an authority host to a canonical hostname or canonical IP literal,
 * or return null if it is neither (which the caller treats as a rejection).
 *
 * Collapses every encoded-IP bypass into one rule: an input is acceptable only
 * if it is (a) a canonical dotted-quad IPv4, (b) a valid IPv6 per net.isIP, or
 * (c) a strict DNS hostname. Hex (0x7f000001), octal (0177.0.0.1), 32-bit
 * decimal (2130706433), short form (127.1), overlong, leading-zero octets, and
 * malformed authorities all fall through to null. IPv4-mapped IPv6
 * (::ffff:a.b.c.d) is unwrapped to its dotted-quad v4 so it cannot smuggle an
 * internal v4 past the v4 classifier.
 *
 * @param {string} host the URL.hostname (already lowercased by WHATWG URL)
 * @returns {string|null} canonical host, or null if not canonical
 */
function normalizeHost(host) {
  if (typeof host !== 'string' || host.length === 0) return null;

  let h = host;

  // Strip the surrounding brackets of an IPv6 literal. On Node 22/24 WHATWG
  // URL.hostname RETAINS the brackets (new URL('http://[::1]/').hostname ===
  // '[::1]'), so without this the bracketed form never reaches net.isIP / the
  // IPv6 classifier and falls to the null/reject branch instead. Stripping them
  // engages the v6 classifier: internal v6 literals are still rejected (now via
  // the classifier, an improvement) and public v6 literals are accepted.
  if (h.startsWith('[') && h.endsWith(']')) {
    h = h.slice(1, -1);
  }

  // Unwrap any IPv4-mapped IPv6 prefix to its embedded dotted-quad v4 so the v4
  // classifier sees the real address. This covers BOTH the short dotted textual
  // form (::ffff:a.b.c.d) AND the canonical hex-grouped form Node's resolver
  // emits for a mapped AAAA record (::ffff:a9fe:a9fe == 169.254.169.254). See
  // ipv4FromMappedIpv6.
  if (net.isIP(h) === 6) {
    const embeddedV4 = ipv4FromMappedIpv6(h);
    if (embeddedV4 !== null) {
      h = embeddedV4;
    }
  }

  // Canonical dotted-quad IPv4?
  if (isCanonicalIpv4(h)) {
    return h;
  }

  // Valid IPv6 literal? (net.isIP returns 6 for a well-formed v6.)
  if (net.isIP(h) === 6) {
    return h;
  }

  // If it contains a dot-and-digits shape but is NOT a canonical dotted-quad,
  // it is an encoded/short/overlong IPv4 bypass - reject. (net.isIP rejects
  // these too, but we also must not let them slip through HOSTNAME_RE: e.g.
  // "10.0.0.256" matches HOSTNAME_RE technically? No - digits/dots only, and
  // HOSTNAME_RE requires the last label to start with a letter-or-digit; an
  // all-numeric label IS allowed by RFC hostnames, so reject all-numeric /
  // dotted-numeric forms explicitly to avoid admitting an encoded IP.)
  if (/^[\d.]+$/.test(h) || /^0x/i.test(h)) {
    return null;
  }

  // Strict DNS hostname.
  if (HOSTNAME_RE.test(h)) {
    return h;
  }

  return null;
}

/**
 * Strict canonical dotted-quad IPv4 check: exactly 4 octets, each digits-only,
 * 0..255, no leading zero.
 * @param {string} h
 * @returns {boolean}
 */
function isCanonicalIpv4(h) {
  const parts = h.split('.');
  if (parts.length !== 4) return false;
  for (const part of parts) {
    if (!IPV4_OCTET_RE.test(part)) return false;
    const n = Number(part);
    if (n < 0 || n > 255) return false;
  }
  return true;
}

/**
 * True if an IP literal (already validated by net.isIP > 0) belongs to a
 * blocked range: private / loopback / link-local / CGNAT / unspecified for v4,
 * loopback / ULA / link-local for v6. Integer per-octet CIDR comparison only -
 * no string matching. IPv4-mapped IPv6 is unwrapped to v4 first.
 *
 * @param {string} ip an IPv4 or IPv6 literal
 * @returns {boolean}
 */
function isBlockedIp(ip) {
  if (typeof ip !== 'string' || ip.length === 0) return false;

  const kind = net.isIP(ip);
  if (kind === 4) return isBlockedIpv4(ip);
  if (kind === 6) {
    // An IPv4-mapped / IPv4-compatible IPv6 address (in ANY textual form -
    // short dotted ::ffff:a.b.c.d OR hex-grouped ::ffff:a9fe:a9fe, which is what
    // dns.lookup actually returns for a mapped AAAA record) carries a real IPv4
    // address in its low 32 bits. Reclassify those 32 bits through the v4 range
    // check so an internal v4 cannot be smuggled past the v6 classifier.
    const embeddedV4 = ipv4FromMappedIpv6(ip);
    if (embeddedV4 !== null) return isBlockedIpv4(embeddedV4);
    return isBlockedIpv6(ip);
  }
  return false;
}

/**
 * If `ip` is a valid IPv6 literal that is IPv4-mapped (::ffff:0:0/96) or
 * IPv4-compatible (::/96, all-zero high 96 bits), return its low 32 bits as a
 * dotted-quad IPv4 string; otherwise return null. Works on ANY textual form by
 * expanding the address to its 16 bytes (does NOT rely on a dotted-only regex),
 * so it catches the hex-grouped form Node's getaddrinfo emits for mapped
 * records (`::ffff:a9fe:a9fe`). The unspecified address (`::`) is left to the
 * v6 classifier (its low bits are 0.0.0.0, which would also block, but `::` is
 * semantically the unspecified address, not an embedded v4).
 *
 * @param {string} ip a literal already validated by net.isIP === 6
 * @returns {string|null} dotted-quad of the low 32 bits, or null
 */
function ipv4FromMappedIpv6(ip) {
  const bytes = ipv6ToBytes(ip);
  if (bytes === null) return null;

  // High 80 bits (bytes 0..9) must be zero for both mapped and compatible.
  for (let i = 0; i < 10; i++) {
    if (bytes[i] !== 0) return null;
  }

  const b10 = bytes[10];
  const b11 = bytes[11];
  const low32 = bytes.slice(12);
  const isMapped = b10 === 0xff && b11 === 0xff;     // ::ffff:0:0/96
  const isCompatible = b10 === 0 && b11 === 0;       // ::/96 (deprecated)
  if (!isMapped && !isCompatible) return null;

  // For the compatible form, keep the v6 classifier authoritative over the two
  // canonical specials :: (unspecified) and ::1 (loopback) - both still block
  // via their own paths, so this is purely for clarity of which range matched.
  if (isCompatible) {
    const low = low32[0] | low32[1] | low32[2];
    if (low === 0 && low32[3] <= 1) return null;     // :: and ::1
  }

  return low32.join('.');
}

/**
 * Expand a valid IPv6 literal to its 16 octets. Handles `::` zero-compression
 * and an embedded dotted-quad IPv4 tail (::ffff:a.b.c.d). Returns null if it
 * does not parse to exactly 16 bytes.
 *
 * @param {string} ip a literal already validated by net.isIP === 6
 * @returns {number[]|null} 16 bytes, or null
 */
function ipv6ToBytes(ip) {
  let s = ip.toLowerCase();

  // Split off an embedded IPv4 dotted-quad tail, if any.
  let v4tail = null;
  const lastColon = s.lastIndexOf(':');
  if (lastColon !== -1) {
    const tail = s.slice(lastColon + 1);
    if (tail.includes('.')) {
      if (!isCanonicalIpv4Loose(tail)) return null;
      v4tail = tail;
      s = s.slice(0, lastColon + 1);
    }
  }

  const halves = s.split('::');
  if (halves.length > 2) return null;

  const headGroups = halves[0] ? halves[0].split(':').filter((g) => g.length > 0) : [];
  const tailGroups = (halves.length > 1 && halves[1])
    ? halves[1].split(':').filter((g) => g.length > 0)
    : [];

  const v4count = v4tail ? 2 : 0;
  let groups;
  if (halves.length === 2) {
    // `::` present -> pad the gap with zero groups.
    const missing = 8 - headGroups.length - tailGroups.length - v4count;
    if (missing < 0) return null;
    groups = headGroups.concat(Array(missing).fill('0')).concat(tailGroups);
  } else {
    groups = headGroups;
    if (groups.length + v4count !== 8) return null;
  }

  const bytes = [];
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    const n = parseInt(g, 16);
    bytes.push((n >> 8) & 0xff, n & 0xff);
  }
  if (v4tail) {
    for (const o of v4tail.split('.')) bytes.push(Number(o) & 0xff);
  }

  return bytes.length === 16 ? bytes : null;
}

/**
 * Loose dotted-quad check (4 octets, 0..255) for an embedded IPv6 v4 tail; the
 * v6 literal was already validated by net.isIP so the form is trustworthy here.
 * @param {string} h
 * @returns {boolean}
 */
function isCanonicalIpv4Loose(h) {
  const parts = h.split('.');
  if (parts.length !== 4) return false;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return false;
    const n = Number(part);
    if (n < 0 || n > 255) return false;
  }
  return true;
}

function isBlockedIpv4(ip) {
  const parts = ip.split('.');
  if (parts.length !== 4) return false;
  const o = parts.map(Number);
  for (const n of o) {
    if (!Number.isInteger(n) || n < 0 || n > 255) return false;
  }
  const [a, b] = o;
  if (a === 0) return true;                            // 0.0.0.0/8 (incl 0.0.0.0)
  if (a === 10) return true;                           // 10.0.0.0/8
  if (a === 127) return true;                          // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true;             // 169.254.0.0/16 link-local (metadata)
  if (a === 172 && b >= 16 && b <= 31) return true;    // 172.16.0.0/12
  if (a === 192 && b === 168) return true;             // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true;   // 100.64.0.0/10 CGNAT
  return false;
}

function isBlockedIpv6(ip) {
  // Expand to a comparable form via net - but net does not expand; classify on
  // the canonical prefix. Lowercase for prefix checks.
  const lower = ip.toLowerCase();
  if (lower === '::1') return true;                    // loopback
  if (lower === '::') return true;                     // unspecified
  // ULA fc00::/7 -> first byte 0xfc or 0xfd.
  if (/^f[cd][0-9a-f]{0,2}:/.test(lower) || /^f[cd]:/.test(lower)) return true;
  // Link-local fe80::/10 -> fe8x / fe9x / feax / febx.
  if (/^fe[89ab][0-9a-f]?:/.test(lower)) return true;
  return false;
}

// Instance metadata endpoints. Never reachable, even when an operator allowlists
// the range they sit in.
// eslint-disable-next-line sonarjs/no-hardcoded-ip -- a deny list, never contacted
const ALWAYS_BLOCKED_IPS = new Set(['169.254.169.254', 'fd00:ec2::254', '100.100.100.200']);

/**
 * Parse TS_ALLOWED_PRIVATE_HOSTS into host names, domain suffixes and an
 * address list. Entries that are none of these are ignored.
 *
 * @param {Object} [env] defaults to process.env
 * @returns {{hosts: Set<string>, suffixes: string[], addresses: net.BlockList, empty: boolean}}
 */
function privateHostAllowlist(env) {
  const raw = String((env || process.env).TS_ALLOWED_PRIVATE_HOSTS || '');
  const hosts = new Set();
  const suffixes = [];
  const addresses = new net.BlockList();
  let empty = true;
  raw.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean).forEach((entry) => {
    const [ip, bits] = entry.split('/');
    const kind = net.isIP(ip);
    if (kind > 0 && bits === undefined) {
      addresses.addAddress(ip, kind === 4 ? 'ipv4' : 'ipv6');
      empty = false;
    } else if (kind > 0 && /^\d{1,3}$/.test(bits) && Number(bits) <= (kind === 4 ? 32 : 128)) {
      addresses.addSubnet(ip, Number(bits), kind === 4 ? 'ipv4' : 'ipv6');
      empty = false;
    } else if (entry.startsWith('.') && HOSTNAME_RE.test(entry.slice(1))) {
      suffixes.push(entry);
      empty = false;
    } else if (HOSTNAME_RE.test(entry)) {
      hosts.add(entry);
      empty = false;
    }
  });
  return {hosts, suffixes, addresses, empty};
}

function isAllowlistedHostname(host, allowlist) {
  return allowlist.hosts.has(host) || allowlist.suffixes.some((suffix) => host.endsWith(suffix));
}

// Is this internal address one the operator allowed (TS_ALLOWED_PRIVATE_HOSTS)?
function isAllowlistedIp(ip, allowlist) {
  if (allowlist.empty || ALWAYS_BLOCKED_IPS.has(ip.toLowerCase())) return false;
  const embeddedV4 = net.isIP(ip) === 6 ? ipv4FromMappedIpv6(ip) : null;
  if (embeddedV4 !== null) {
    return !ALWAYS_BLOCKED_IPS.has(embeddedV4) && allowlist.addresses.check(embeddedV4, 'ipv4');
  }
  return allowlist.addresses.check(ip, net.isIP(ip) === 4 ? 'ipv4' : 'ipv6');
}

// An internal address is refused unless the operator allowlisted it, or the host
// name it was resolved from (`trustedHost`). Metadata addresses always are.
function isRefusedIp(ip, allowlist, trustedHost) {
  if (!isBlockedIp(ip)) return false;
  if (trustedHost) {
    const embeddedV4 = net.isIP(ip) === 6 ? ipv4FromMappedIpv6(ip) : null;
    return ALWAYS_BLOCKED_IPS.has(ip.toLowerCase()) || ALWAYS_BLOCKED_IPS.has(embeddedV4);
  }
  return !isAllowlistedIp(ip, allowlist);
}

/**
 * SYNC input gate. Parse the URL, enforce scheme + host, reject literal
 * internal IPs (after normalization). Hostnames are accepted (resolved later at
 * egress). Throws a plain Error with .code = 400 and a generic message on any
 * rejection. Returns the parsed WHATWG URL on success.
 *
 * @param {string} url
 * @returns {URL} the parsed URL
 */
function assertSafePublicUrl(url) {
  if (typeof url !== 'string' || url.trim().length === 0) {
    throw blocked400();
  }

  let parsed;
  try {
    parsed = new URL(url);
  // eslint-disable-next-line sonarjs/no-ignored-exceptions
  } catch (_e) {
    throw blocked400();
  }

  // Scheme allow-list (URL.protocol includes the trailing colon).
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw blocked400();
  }

  if (!parsed.hostname || parsed.hostname.length === 0) {
    throw blocked400();
  }

  // NOTE: on Node 22/24 URL.hostname RETAINS the brackets of an IPv6 literal
  // (new URL('http://[::1]/').hostname === '[::1]'). normalizeHost strips them
  // and runs the IPv6 classifier, so a bracketed internal literal is rejected
  // here and a bracketed public literal is accepted.
  const host = normalizeHost(parsed.hostname);
  if (host === null) {
    // Not a canonical hostname or canonical IP -> encoded bypass / junk.
    throw blocked400();
  }

  // If the normalized host is a literal IP, classify it now. A hostname is
  // left for the egress layer to resolve.
  if (net.isIP(host) > 0 && isRefusedIp(host, privateHostAllowlist(), false)) {
    throw blocked400();
  }

  return parsed;
}

/**
 * ASYNC egress gate. Scheme allow-list -> normalize host -> if literal IP
 * classify directly, else DNS-resolve and classify EVERY returned address;
 * reject if ANY is blocked. Throws a plain Error with .code = 'SSRF_BLOCKED'
 * (generic message, no IP) on rejection. Returns {url, addresses} on success.
 *
 * @param {string} url
 * @returns {Promise<{url: URL, addresses: string[]}>}
 */
async function assertSafeEgressUrl(url) {
  if (typeof url !== 'string' || url.trim().length === 0) {
    throw blockedEgress();
  }

  let parsed;
  try {
    parsed = new URL(url);
  // eslint-disable-next-line sonarjs/no-ignored-exceptions
  } catch (_e) {
    throw blockedEgress();
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw blockedEgress();
  }

  const host = normalizeHost(parsed.hostname);
  if (host === null) {
    throw blockedEgress();
  }

  const allowlist = privateHostAllowlist();
  // Literal IP: classify directly, no DNS.
  if (net.isIP(host) > 0) {
    if (isRefusedIp(host, allowlist, false)) {
      throw blockedEgress();
    }
    return {url: parsed, addresses: [host]};
  }
  const trustedHost = isAllowlistedHostname(host, allowlist);

  // Hostname: resolve ALL records and classify each. verbatim:true keeps the
  // resolver order (we check every address regardless).
  let records;
  try {
    records = await dns.lookup(host, {all: true, verbatim: true});
  // eslint-disable-next-line sonarjs/no-ignored-exceptions
  } catch (_e) {
    // Unresolvable host -> refuse (cannot prove it is public).
    throw blockedEgress();
  }
  if (!Array.isArray(records) || records.length === 0) {
    throw blockedEgress();
  }
  const addresses = records.map((r) => r.address);
  for (const address of addresses) {
    if (isRefusedIp(address, allowlist, trustedHost)) {
      throw blockedEgress();
    }
  }
  return {url: parsed, addresses};
}

function blocked400() {
  const err = new Error(BLOCKED_REASON);
  err.code = 400;
  err.isSsrf = true;
  return err;
}

function blockedEgress() {
  const err = new Error('Request blocked');
  err.code = 'SSRF_BLOCKED';
  err.isSsrf = true;
  return err;
}

module.exports = {
  assertSafePublicUrl,
  assertSafeEgressUrl,
  normalizeHost,
  isBlockedIp,
  privateHostAllowlist,
  BLOCKED_REASON
};
