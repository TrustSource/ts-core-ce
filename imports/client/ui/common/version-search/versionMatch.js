// Version filter matching.
//
// CommonJS with no meteor/* imports so Jest can require it directly, following
// the same split as searchPhases.js: the rule lives apart from the ReactiveVar
// and Session machinery precisely so it is testable without a Meteor harness.

function readVersionString(item) {
  if (!item) {
    return '';
  }
  // Index records carry a plain `version` field; the Version model exposes
  // getVersion() over the stored doc.
  if (typeof item.getVersion === 'function') {
    return item.getVersion() || '';
  }
  return item.version || '';
}

// Case-insensitive substring match on the version string, deliberately not a
// semver range: version strings in the wild are not all semver (apk's 1.2.3-r4,
// nuget's four-part builds), and a half-remembered "2.1" should find them.
//
// An empty or whitespace-only term matches everything, so the unfiltered list is
// the resting state rather than a special case at every call site.
function matchVersions(versions, term) {
  if (!(versions instanceof Array)) {
    return [];
  }
  const needle = String(term == null ? '' : term).trim().toLowerCase();
  if (!needle) {
    return versions;
  }
  return versions.filter(function (item) {
    return readVersionString(item).toLowerCase().indexOf(needle) !== -1;
  });
}

module.exports = {matchVersions, readVersionString};
