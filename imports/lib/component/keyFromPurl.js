const {PackageURL} = require('packageurl-js');
const {DEFAULT_PACKAGE_TYPE, isAllowedPackageType} = require('./packageTypes');

function keyFromParsedPurl(pkg) {
  if (!pkg || !pkg.type || !pkg.name) return null;
  return pkg.namespace ? `${pkg.type}:${pkg.namespace}:${pkg.name}` : `${pkg.type}:${pkg.name}`;
}

function parsedFromPurlString(purl) {
  if (!purl) return null;
  try {
    return PackageURL.fromString(purl);
  } catch (_e) { // eslint-disable-line sonarjs/no-ignored-exceptions -- fallback to regex below
    const match = purl.match(/^pkg:([^/]+)\/(?:([^/]+)\/)?([^@?#]+)/);
    if (match) {
      return {type: match[1], namespace: match[2] || null, name: match[3]};
    }
    return null;
  }
}

function looksLikeComponentKey(candidate, pkgType) {
  if (typeof candidate !== 'string' || !candidate) return false;
  if (candidate.indexOf(':') < 0) return false;
  if (/[@?#/]/.test(candidate)) return false;
  if (pkgType && candidate.split(':')[0] !== pkgType) return false;
  return true;
}

function purlToKey(purl, pkgType, name, bomRef) {
  const parsed = parsedFromPurlString(purl);
  const fromPurl = keyFromParsedPurl(parsed);
  if (fromPurl) return fromPurl;
  if (looksLikeComponentKey(bomRef, pkgType)) return bomRef;
  if (pkgType && name) return `${pkgType}:${name}`;
  return name || null;
}

function splitComponentKey(key) {
  if (typeof key !== 'string' || !key) return null;
  const parts = key.split(':');
  if (parts.length < 2) return null;
  if (parts.length === 2) {
    return {manager: parts[0], namespace: null, name: parts[1]};
  }
  return {manager: parts[0], namespace: parts[1], name: parts.slice(2).join(':')};
}

// SPDX carries no package-manager type of its own, so a key built from an SPDXID or a package
// name arrives without the `type:` prefix every component key needs ("npm-lodash", or a bare
// document name like "nordwind-mobile-app"). Promoting the text before the first "-" only
// works when that text really is a package type: "npm-lodash" -> "npm:lodash", but
// "nordwind-mobile-app" used to become "nordwind:mobile-app", which no package type matches
// and which then failed key validation. Anything whose head is not a known type keeps its full
// name and gets the neutral `generic:` prefix instead.
function clearSpdxKey(key) {
  if (key && key[0] === '-') {
    key = key.substring(1, key.length);
  }
  if (key && key[0] === ':') {
    key = key.substring(1, key.length);
  }
  if (!key || key.match(/:/)) {
    return key;
  }
  const parts = key.split('-');
  if (parts.length > 1 && isAllowedPackageType(parts[0])) {
    const head = parts[0];
    parts.shift();
    return `${head}:${parts.join('-')}`;
  }
  return `${DEFAULT_PACKAGE_TYPE}:${key}`;
}

module.exports = {
  purlToKey,
  keyFromParsedPurl,
  splitComponentKey,
  clearSpdxKey
};
