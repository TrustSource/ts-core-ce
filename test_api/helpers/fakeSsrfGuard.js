/* eslint-disable no-undef */
// A stand-in for imports/lib/security/ssrfGuard.js whose assertSafeEgressUrl answers from a
// fixed host -> addresses map instead of DNS, so a unit spec never resolves a name for real.
//
// Only the resolver is fake. Which host a url names comes from the REAL normalizeHost, and
// whether an address is blocked from the REAL isBlockedIp. A host missing from the map
// behaves like a failed lookup. Every other export is the real module's.
const {URL} = require('url');
const net = require('net');
const realGuard = require('../../imports/lib/security/ssrfGuard');

function blockedEgress() {
  const error = new Error('Request blocked');
  error.code = 'SSRF_BLOCKED';
  error.isSsrf = true;
  return error;
}

function parseHttpUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch (e) {
    throw blockedEgress();
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw blockedEgress();
  }
  return parsed;
}

/**
 * @param {Object<string, string[]>} hosts host name -> the addresses its lookup answers with
 * @returns {object} the guard module, plus `lookups` (every host name the fake "resolved")
 */
function fakeSsrfGuard(hosts) {
  const lookups = [];
  async function assertSafeEgressUrl(url) {
    if (typeof url !== 'string') {
      throw blockedEgress();
    }
    const parsed = parseHttpUrl(url);
    const host = realGuard.normalizeHost(parsed.hostname);
    if (host === null) {
      throw blockedEgress();
    }
    let addresses = [host];
    if (net.isIP(host) === 0) {
      lookups.push(host);
      if (!Object.prototype.hasOwnProperty.call(hosts, host)) {
        throw blockedEgress();
      }
      addresses = hosts[host].slice();
    }
    if (!addresses.length || addresses.some(realGuard.isBlockedIp)) {
      throw blockedEgress();
    }
    return {url: parsed, addresses};
  }
  return Object.assign({}, realGuard, {assertSafeEgressUrl, lookups});
}

module.exports = {fakeSsrfGuard};
