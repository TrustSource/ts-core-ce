// Which seed infrastructure components a start has to insert.
//
// Components are seeded once. An entry is inserted only while no component with its key
// exists, compared ignoring case, and an existing component is never touched: an edit
// made in the UI survives every restart, and a key added to the seed file is picked up
// on the next start.
//
// Plain CommonJS with no imports, so Jest requires it directly.

const SEED_FIELDS = ['key', 'name', 'description', 'category', 'language', 'urls', 'versions'];

/**
 * @param {Array<Object>} entries the seed file's components
 * @param {Array<String>} existingKeys keys already in the catalog
 * @returns {Array<Object>} fresh documents to insert
 */
function infrastructureComponentsToSeed(entries, existingKeys) {
  const taken = new Set((existingKeys || [])
    .filter(function (key) { return typeof key === 'string'; })
    .map(function (key) { return key.toLowerCase(); }));
  const out = [];
  (entries || []).forEach(function (entry) {
    const lower = entry.key.toLowerCase();
    if (taken.has(lower)) {
      return;
    }
    taken.add(lower);
    const doc = {};
    SEED_FIELDS.forEach(function (field) {
      if (entry[field] !== undefined) {
        // Deep-copied: the seed file is a module-level import, and the driver must not
        // end up holding a reference into it.
        doc[field] = JSON.parse(JSON.stringify(entry[field]));
      }
    });
    out.push(doc);
  });
  return out;
}

module.exports = {
  infrastructureComponentsToSeed
};
