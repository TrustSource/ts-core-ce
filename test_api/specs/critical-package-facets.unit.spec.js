// The Critical Components tab strip gained plain package-type facets, so that
// types TrustSource ships no crawler for (deb is the second-largest type in the
// lake) are reachable at all.
//
// The type id arrives from a route param and ends up in a Mongo $regex, so the
// resolve-then-build behaviour is the part worth pinning: a client string must
// never reach the pattern, and an unknown id must fail closed rather than
// falling back to the unfiltered critical list.
const path = require('path');
const fs = require('fs');
const {
  PACKAGE_TYPE_FACETS,
  packageTypeFacets,
  packageTypeFacetRouteNames,
  packageTypeFacetQuery
} = require('../../imports/lib/component/criticalPackageFacets');
const {
  ALLOWED_PACKAGE_TYPES
} = require('../../imports/lib/component/packageTypes');

describe('critical components package-type facets', () => {
  it('anchors the pattern to the key prefix', () => {
    expect(packageTypeFacetQuery('deb')).toEqual({$or: [{key: {$regex: '^deb:'}}]});
  });

  it('covers every alias a type is stored under', () => {
    expect(packageTypeFacetQuery('apk').$or).toEqual([
      {key: {$regex: '^apk:'}}, {key: {$regex: '^alpine:'}}]);
    expect(packageTypeFacetQuery('golang').$or).toEqual([
      {key: {$regex: '^go:'}}, {key: {$regex: '^golang:'}}]);
    // Dart/Flutter is keyed 'pub:', so that is the only prefix it can match.
    expect(packageTypeFacetQuery('dart').$or).toEqual([{key: {$regex: '^pub:'}}]);
  });

  it('fails closed on an unknown type instead of matching everything', () => {
    expect(packageTypeFacetQuery('nope')).toBeNull();
    expect(packageTypeFacetQuery('')).toBeNull();
    expect(packageTypeFacetQuery(undefined)).toBeNull();
    expect(packageTypeFacetQuery(null)).toBeNull();
  });

  it('never lets a client string reach the pattern', () => {
    // A crafted id resolves against the table by exact match and misses, so
    // neither a regex nor a Mongo operator can be smuggled through.
    expect(packageTypeFacetQuery('.*')).toBeNull();
    expect(packageTypeFacetQuery('deb|npm')).toBeNull();
    expect(packageTypeFacetQuery('(a+)+$')).toBeNull();
    expect(packageTypeFacetQuery({$ne: null})).toBeNull();
    expect(packageTypeFacetQuery(['deb'])).toBeNull();
  });

  it('gives every facet a distinct id and route name', () => {
    const ids = PACKAGE_TYPE_FACETS.map(f => f.id);
    const routes = packageTypeFacetRouteNames();
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(routes).size).toBe(routes.length);
    expect(routes.length).toBe(ids.length);
  });

  it('does not collide with the five crawler-backed tabs', () => {
    const crawlerTabs = ['github', 'maven', 'nuget', 'npm', 'pypi'];
    PACKAGE_TYPE_FACETS.forEach(f => expect(crawlerTabs).not.toContain(f.id));
  });

  it('only uses prefixes a component key may actually carry', () => {
    // 'apk' is the documented exception: absent from the allowed list, but
    // present on real component keys, so the facet still matches it.
    const KNOWN_EXCEPTIONS = ['apk'];
    packageTypeFacets().forEach(facet => {
      facet.prefixes.forEach(prefix => {
        if (KNOWN_EXCEPTIONS.indexOf(prefix) !== -1) return;
        expect(ALLOWED_PACKAGE_TYPES).toContain(prefix);
      });
    });
  });

  it('is the single source of truth shared with getFilterCritical', () => {
    // getFilterCritical consults the same table, so an ecosystem filter and the
    // Apk tab cannot disagree about whether alpine: counts.
    const REST = fs.readFileSync(
      path.join(__dirname, '../../imports/server/rest-api/RestApi.js'), 'utf8');
    expect(REST).toContain('packageTypeFacetQuery');
    // ...and an ecosystem outside the table still falls back to one literal prefix
    expect(REST).toContain("ecosystem.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')");
  });

  it('leaves gradle out - it owns no key prefix', () => {
    expect(PACKAGE_TYPE_FACETS.map(f => f.id)).not.toContain('gradle');
    expect(ALLOWED_PACKAGE_TYPES).not.toContain('gradle');
  });
});
