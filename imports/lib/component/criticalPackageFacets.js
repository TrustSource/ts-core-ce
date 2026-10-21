// Plain package-type facets for the Critical Components tab strip.
//
// Deliberately not the same thing as the five crawler-backed tabs (github,
// mavencentral-releases, nuget-releases, npm-releases, pypi): those also
// require the component to be due a crawl, so a tab there means "of this type
// AND queued for crawling". For an ecosystem TrustSource ships no crawler for,
// the only honest statement is "of this type", which is what these are. Without
// them those types are unreachable from the strip at all - deb alone is the
// second-largest type in the component lake.
//
// Prefixes are drawn from ALLOWED_PACKAGE_TYPES next door (the single source of
// truth for what a component key may start with) and match what getPkgMgrIcon
// draws, so a tab can never disagree with the icons on its own rows. Gradle has
// no entry on purpose: it owns no key prefix, its projects resolve to maven:.
//
// Plain CommonJS with no imports, same as packageTypes.js, so the query builder
// stays requireable under Jest.

const {isAllowedPackageType} = require('./packageTypes');

const PACKAGE_TYPE_FACETS = [
  {id: 'deb', label: 'Deb', routeName: 'criticalComponentsDeb', prefixes: ['deb']},
  {id: 'cocoapods', label: 'CocoaPods', routeName: 'criticalComponentsCocoapods', prefixes: ['cocoapods']},
  // 'apk' is absent from ALLOWED_PACKAGE_TYPES yet components carry apk: keys,
  // so the facet matches both spellings rather than hiding those rows.
  {id: 'apk', label: 'Apk', routeName: 'criticalComponentsApk', prefixes: ['apk', 'alpine']},
  {id: 'cargo', label: 'Cargo', routeName: 'criticalComponentsCargo', prefixes: ['cargo']},
  // Dart/Flutter packages are keyed 'pub:' - 'dart' is not a valid key prefix.
  {id: 'dart', label: 'Dart', routeName: 'criticalComponentsDart', prefixes: ['pub']},
  {id: 'golang', label: 'Go', routeName: 'criticalComponentsGolang', prefixes: ['go', 'golang']}
];

function packageTypeFacets() {
  return PACKAGE_TYPE_FACETS;
}

function packageTypeFacetRouteNames() {
  return PACKAGE_TYPE_FACETS.map(function (facet) {
    return facet.routeName;
  });
}

function findPackageTypeFacet(id) {
  if (!id || typeof id !== 'string') {
    return null;
  }
  return PACKAGE_TYPE_FACETS.find(function (facet) {
    return facet.id === id;
  }) || null;
}

/**
 * Selector for every component of this type.
 *
 * The id arrives from a route param, so it is resolved against the table by
 * exact match and the pattern is then built from the table's own prefixes - a
 * client string never reaches the regex. Returns null for an unknown id so
 * callers fail closed rather than falling back to "everything".
 */
function packageTypeFacetQuery(id) {
  const facet = findPackageTypeFacet(id);
  if (!facet) {
    return null;
  }
  return {
    $or: facet.prefixes.map(function (prefix) {
      return {key: {$regex: '^' + prefix + ':'}};
    })
  };
}

module.exports = {
  PACKAGE_TYPE_FACETS,
  packageTypeFacets,
  packageTypeFacetRouteNames,
  findPackageTypeFacet,
  packageTypeFacetQuery,
  isAllowedPackageType
};
