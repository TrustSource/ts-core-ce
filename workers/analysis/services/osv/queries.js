import { createHash } from 'node:crypto';

// Which (component key, version) pairs an analysis asks OSV about, and in what form.
// Pure: no network, no database.

// The longest component key and version the app itself looks up
// (COMPONENT_KEY_LOOKUP_MAX / VERSION_STRING_MAX in imports/lib/component/Vulnerability.js).
export const KEY_MAX = 2000;
export const VERSION_MAX = 200;

// A NUL appears in neither a key nor a version, so no two pairs can share an id.
const SEPARATOR = String.fromCharCode(0);

// The `cves` document id of one pair. ts-app computes the same id in
// imports/server/osv/pairId.js; both test suites pin the same value.
export function pairId(key, version) {
  return 'osv:' + createHash('sha1').update(key + SEPARATOR + version).digest('hex');
}

// Component key prefix -> OSV ecosystem. The prefixes mirror toPurl in
// imports/lib/converter/vex.js (the worker cannot import from imports/).
const ECOSYSTEMS = {
  npm: 'npm',
  maven: 'Maven',
  mvn: 'Maven',
  pypi: 'PyPI',
  pip: 'PyPI',
  py: 'PyPI',
  nuget: 'NuGet',
  cargo: 'crates.io',
  golang: 'Go',
  go: 'Go',
  gomod: 'Go',
  gem: 'RubyGems',
  rubygems: 'RubyGems',
  composer: 'Packagist',
  pub: 'Pub',
  dart: 'Pub'
};

// purl types OSV resolves. Nothing else is sent: one query OSV cannot parse fails the
// whole querybatch request.
const PURL_TYPES = new Set(['npm', 'maven', 'pypi', 'nuget', 'cargo', 'golang', 'gem', 'composer', 'pub']);

// The segments of a purl base after 'pkg:', percent-decoded. Null when one of them
// cannot be decoded: OSV answers HTTP 400 for the whole querybatch on a bad escape.
function decodedSegments(base) {
  try {
    return base.slice(4).split('/').map(segment => decodeURIComponent(segment));
  } catch {
    return null;
  }
}

// 'pkg:npm/lodash@4.17.20?x=1#sub' -> 'pkg:npm/lodash'. Null for anything OSV should not see.
export function purlBase(purl) {
  if (typeof purl !== 'string' || purl.indexOf('pkg:') !== 0) {
    return null;
  }
  let base = purl.split('#')[0].split('?')[0];
  const at = base.indexOf('@', base.lastIndexOf('/') + 1);
  if (at > -1) {
    base = base.slice(0, at);
  }
  const slash = base.indexOf('/');
  if (slash === -1) {
    return null;
  }
  const type = base.slice(4, slash).toLowerCase();
  if (!PURL_TYPES.has(type) || base.length <= slash + 1 || !decodedSegments(base)) {
    return null;
  }
  return base;
}

// A purl base -> the component key it names, built the way ts-app builds one
// (keyFromParsedPurl in imports/lib/component/keyFromPurl.js): 'type:namespace:name', or
// 'type:name' without a namespace. 'pkg:npm/%40babel/core' -> 'npm:@babel:core'.
export function purlKey(base) {
  if (typeof base !== 'string' || base.indexOf('pkg:') !== 0) {
    return null;
  }
  const segments = decodedSegments(base);
  if (!segments || segments.length < 2) {
    return null;
  }
  const type = segments[0];
  const name = segments[segments.length - 1];
  const namespace = segments.slice(1, -1).join('/');
  return namespace ? type + ':' + namespace + ':' + name : type + ':' + name;
}

// The form two keys are compared in: case-insensitive, 'mvn:' read as 'maven:'.
function comparableKey(key) {
  const lower = key.toLowerCase();
  return lower.indexOf('mvn:') === 0 ? 'maven:' + lower.slice(4) : lower;
}

// The OSV `package` of one component: the scan node's purl when it is usable and names
// the key's own package (it keeps the original case, which Go module paths and NuGet ids
// need), otherwise the ecosystem and name derived from the lower-cased component key. The
// answer is filed under the key's pair id, so a purl naming another package is ignored:
// it would write that package's findings into this pair's shared document.
export function osvPackage(key, purl) {
  const base = purlBase(purl);
  if (base && typeof key === 'string' && comparableKey(purlKey(base)) === comparableKey(key)) {
    return { purl: base };
  }
  if (typeof key !== 'string') {
    return null;
  }
  const parts = key.split(':');
  const ecosystem = ECOSYSTEMS[parts[0]];
  if (!ecosystem || parts.length < 2) {
    return null;
  }
  const rest = parts.slice(1);
  let name;
  if (ecosystem === 'Maven') {
    // Maven names are group:artifact; a key without a group cannot be looked up.
    name = rest.length >= 2 ? rest.join(':') : '';
  } else if (rest.length === 1) {
    name = rest[0];
  } else {
    name = rest[0] + '/' + rest.slice(1).join(':');
  }
  return name ? { ecosystem, name } : null;
}

function usableVersion(version) {
  // '0.0.0' is the analyzer's placeholder for "no version"; a query without a real
  // version would return every vulnerability the package ever had.
  return typeof version === 'string' && version !== '' && version !== '0.0.0' && version.length <= VERSION_MAX;
}

// One query per distinct (key, version) of the analysed module. `purls` maps pairId -> the
// scan node's purl; `skip(key, versions)` answers true for whitelisted components, which
// the vulnerability analysis ignores too.
export function buildQueries(components, purls, skip) {
  const queries = [];
  const seen = new Set();
  for (const comp of Object.values(components || {})) {
    const key = comp && comp.key;
    if (typeof key !== 'string' || !key || key.length > KEY_MAX) {
      continue;
    }
    const allVersions = (comp.versions || []).map(entry => entry && entry.version);
    const versions = allVersions.filter(usableVersion);
    if (!versions.length || (skip && skip(key, allVersions))) {
      continue;
    }
    for (const version of versions) {
      const id = pairId(key, version);
      if (seen.has(id)) {
        continue;
      }
      seen.add(id);
      const pkg = osvPackage(key, purls && purls.get(id));
      if (pkg) {
        queries.push({ id, key, version, package: pkg });
      }
    }
  }
  return queries;
}
