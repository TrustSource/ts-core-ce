// Which seed licenses a start has to insert.
//
// Licenses are seeded once. An entry is inserted only while no license with its key
// exists, compared ignoring case the way license matching compares keys, and an
// existing license is never touched: an edit made in the UI survives every restart,
// and a key added to the seed file is picked up on the next start.
//
// Plain CommonJS with no imports, so Jest requires it directly.

/**
 * @param {Array<{key, name, url, text}>} entries the seed file's licenses
 * @param {Array<String>} existingKeys keys already in the catalog
 * @returns {Array<{key, name, url, text}>} fresh documents to insert
 */
function licensesToSeed(entries, existingKeys) {
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
    out.push({key: entry.key, name: entry.name, url: entry.url, text: entry.text});
  });
  return out;
}

module.exports = {
  licensesToSeed
};
