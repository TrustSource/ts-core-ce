// Where a component version sits in a dependency tree, as stored on a version's `paths`.
//
// This analysis writes those entries as plain STRINGS (see buildVersionEntry); only
// records written by much older versions carry a {path, licenses} object. Reading
// `.path` unconditionally yields undefined from the modern shape, which is how every
// legal-analysis license component ended up stored with `path: null` - and from there
// every notice-file component with `paths: [null]`.
//
// Twin of imports/lib/analysis/pathLocation.js on the ts-app side; workers/ cannot
// import from imports/, so the two are kept in step by their own tests.

/**
 * Normalise one `paths` entry to its location string.
 *
 * @param {String|Object} path one entry of a version's `paths` array
 * @returns {String|null} the location, or null when the entry carries none
 */
export function pathLocation(path) {
  if (typeof path === 'string') {
    return path || null;
  }
  if (path && typeof path.path === 'string') {
    return path.path || null;
  }
  return null;
}

/**
 * The per-path license annotations of an older {path, licenses} entry. A string entry
 * carries none.
 *
 * @param {String|Object} path one entry of a version's `paths` array
 * @returns {Array} the annotations, never undefined
 */
export function pathLicenses(path) {
  return (path && Array.isArray(path.licenses)) ? path.licenses : [];
}
