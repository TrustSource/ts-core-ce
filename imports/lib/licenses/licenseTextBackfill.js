// Which seeded license texts a start has to backfill.
//
// Licenses are inserted once, by key (see licenseSeed.js). That leaves every catalog
// that predates a seed entry carrying the row WITHOUT its license text: the insert is
// skipped because the key is taken, and nothing ever fills the gap. A notice file then
// attributes components under a license whose text it cannot print - on this catalog
// that was Apache-2.0, covering the large majority of components.
//
// Backfilling is not overwriting: only a row whose text is absent or empty is filled,
// so a text edited in the UI, or deliberately cleared, is never touched.
//
// Plain CommonJS with no imports, so Jest requires it directly.

function isBlank(value) {
  return value === undefined || value === null || String(value).trim() === '';
}

/**
 * @param {Array<{key, text}>} entries the seed file's licenses
 * @param {Array<{_id, key, text}>} existing the catalog rows
 * @returns {Array<{_id, key, text}>} one backfill per row that has no text of its own
 */
function licenseTextsToBackfill(entries, existing) {
  const byKey = new Map();
  (existing || []).forEach(function (doc) {
    if (doc && typeof doc.key === 'string') {
      // First row wins: a duplicate key is a catalog problem of its own, and filling
      // the same text twice would be the only alternative.
      const lower = doc.key.toLowerCase();
      if (!byKey.has(lower)) {
        byKey.set(lower, doc);
      }
    }
  });
  const out = [];
  (entries || []).forEach(function (entry) {
    if (!entry || typeof entry.key !== 'string' || isBlank(entry.text)) {
      return;
    }
    const doc = byKey.get(entry.key.toLowerCase());
    if (doc && isBlank(doc.text)) {
      out.push({_id: doc._id, key: doc.key, text: entry.text});
    }
  });
  return out;
}

module.exports = {
  licenseTextsToBackfill
};
