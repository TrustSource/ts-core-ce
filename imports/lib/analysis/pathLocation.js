// Where a component version sits in a dependency tree, as stored on
// `analysis.components[].versions[].paths`.
//
// An analysis writes those entries as plain STRINGS; only some older records carry a
// {path, licenses} object. A reader that takes `.path` unconditionally gets `undefined`
// from the modern shape, which is how the approval changes report ended up storing
// "<module> > undefined" for every component and how every notice-file component ended
// up with `paths: [null]`.
//
// CommonJS with no meteor/* imports so Jest can require it directly. The analysis worker
// keeps its own copy (workers/analysis/services/paths.js) because workers/ cannot import
// from imports/; both are pinned by their own tests.

/**
 * Normalise one `versions[].paths` entry to its location string.
 *
 * @param {String|Object} path one entry of a version's `paths` array
 * @returns {String|null} the location, or null when the entry carries none
 */
function pathLocation(path) {
  if (typeof path === 'string') {
    return path || null;
  }
  if (path && typeof path.path === 'string') {
    return path.path || null;
  }
  return null;
}

/**
 * Label a component's location for a report: "<module> > <path>", or just the module
 * when the entry carries no usable path. Never emits the string "undefined".
 *
 * @param {String} moduleName the module the component was found in
 * @param {String|Object} path one entry of a version's `paths` array
 * @returns {String} the label
 */
function pathLabel(moduleName, path) {
  const location = pathLocation(path);
  return location ? moduleName + ' > ' + location : moduleName;
}

/**
 * The per-path license annotations of an older {path, licenses} entry. A string entry
 * carries none.
 *
 * @param {String|Object} path one entry of a version's `paths` array
 * @returns {Array} the annotations, never undefined
 */
function pathLicenses(path) {
  return (path && Array.isArray(path.licenses)) ? path.licenses : [];
}

module.exports = {pathLocation, pathLabel, pathLicenses};
