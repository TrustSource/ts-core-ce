// The `cves` document of one (component key, version) pair, as the analysis worker writes
// it (workers/analysis/services/osv/queries.js computes the same id; both test suites pin
// the same value). CommonJS with no meteor/* imports so Jest can require it directly.
const crypto = require('crypto');
const {PackageURL} = require('packageurl-js');
const {keyFromParsedPurl} = require('../../lib/component/keyFromPurl');

// A NUL appears in neither a key nor a version, so no two pairs can share an id.
const SEPARATOR = String.fromCharCode(0);
const PURL_MAX = 2200;

function pairId(key, version) {
  // sha1 here derives a deterministic cache-document id, not a security digest.
  // eslint-disable-next-line sonarjs/hashing -- id derivation, not a security context
  return 'osv:' + crypto.createHash('sha1').update(key + SEPARATOR + version).digest('hex');
}

// 'pkg:nuget/Newtonsoft.Json@13.0.1' -> {key: 'nuget:Newtonsoft.Json', version: '13.0.1'},
// the key as the purl writes it. Null when unusable.
function writtenPairFromPurl(purl) {
  if (typeof purl !== 'string' || purl.length > PURL_MAX) {
    return null;
  }
  let parsed;
  try {
    parsed = PackageURL.fromString(purl);
  } catch (e) { // eslint-disable-line sonarjs/no-ignored-exceptions -- an unparsable purl just means "no pair"
    return null;
  }
  const key = keyFromParsedPurl(parsed);
  if (!key || !parsed.version) {
    return null;
  }
  return {key: key, version: parsed.version};
}

// 'pkg:npm/lodash@4.17.20' -> {key: 'npm:lodash', version: '4.17.20'}. Component keys are
// stored lower-cased (see processScan), so the key is too. Null when unusable.
function pairFromPurl(purl) {
  const pair = writtenPairFromPurl(purl);
  return pair ? {key: pair.key.toLowerCase(), version: pair.version} : null;
}

// The `cves` document ids a versioned purl may be cached under: its key as written and
// lower-cased, once each. A stored scan (and so the analysis) can keep a mixed-case key
// (PyPI, NuGet, Go). Empty when the purl is unusable.
function pairIdsFromPurl(purl) {
  const pair = writtenPairFromPurl(purl);
  if (!pair) {
    return [];
  }
  const ids = [pairId(pair.key, pair.version), pairId(pair.key.toLowerCase(), pair.version)];
  return ids[0] === ids[1] ? [ids[0]] : ids;
}

module.exports = {pairId, pairFromPurl, pairIdsFromPurl};
