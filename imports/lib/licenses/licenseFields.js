// The fields a license may carry outside the server.
//
// The Community Edition carries no legal assessment of licenses. Databases that
// predate that decision (a local dev database, a restored dump) can still hold
// `constraints`, `analysed`, `editorial` or `disclaimer`, so every path that sends a
// license to a client projects through this list instead of trusting what is stored.
//
// Plain CommonJS with no imports, so Jest requires it directly and both bundles
// can carry it.

const LICENSE_FIELDS = ['key', 'name', 'url', 'aliases', 'text', 'copyright', 'created', 'updated'];

/**
 * A Mongo inclusion projection over LICENSE_FIELDS.
 *
 * @param {{withText: Boolean}} [options] `withText` false leaves out the license
 *   text, for lists that never render it
 * @returns {Object} a fresh projection, e.g. {key: 1, name: 1, ...}
 */
function licenseProjection(options) {
  const withText = !!(options && options.withText);
  const projection = {};
  LICENSE_FIELDS.forEach(function (field) {
    if (field !== 'text' || withText) {
      projection[field] = 1;
    }
  });
  return projection;
}

module.exports = {
  LICENSE_FIELDS,
  licenseProjection
};
