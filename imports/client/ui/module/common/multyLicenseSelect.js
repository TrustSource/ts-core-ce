// Pure helper for the multi-license dialog submit logic.
//
// Extracted so the licensesSelected array rebuild - the part that must target
// the clicked component and produce exactly the `updateCollection` payload -
// can be unit-tested without Meteor / Blaze / a running app. The Blaze template
// (component-multy-license.js) imports buildLicensesSelected and feeds it the
// module's current selection, the clicked component key, the chosen license and
// the comment string; the resulting array is what gets persisted via
// Meteor.callAsync('updateCollection', 'Modules', …, 'componentConfig.licensesSelected', …).
//
// CommonJS so it runs under the Jest (`yarn test`) harness in test_api/.

/**
 * Rebuild the module's licensesSelected array for a single component.
 *
 * Removes any existing entry for `componentKey` and appends the freshly chosen
 * one. Only the clicked component's entry changes - every other component's
 * selection is preserved untouched.
 *
 * @param {Array<{key:string, license:string, comment?:string}>} current existing licensesSelected
 * @param {string} componentKey the clicked component's key
 * @param {string} selectedLicense the chosen license key
 * @param {string} comment audit comment string
 * @returns {Array} the new licensesSelected array (does not mutate `current`)
 */
function buildLicensesSelected(current, componentKey, selectedLicense, comment) {
  const arr = Array.isArray(current) ? current.slice() : [];
  const filtered = arr.filter(function (e) {
    return !e || e.key !== componentKey;
  });
  filtered.push({key: componentKey, comment: comment, license: selectedLicense});
  return filtered;
}

module.exports = {buildLicensesSelected};
