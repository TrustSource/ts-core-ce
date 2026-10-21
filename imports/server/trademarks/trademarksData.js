// The Copyright & Trademarks entries shipped with the Community Edition.
//
// Trademarks cannot be edited in CE. This list is the source of truth: every start
// upserts each entry by its fixed _id with all its fields, so a deployment always
// overwrites what is stored. Documents that are not in this list are left alone.
//
// Plain CommonJS with no imports, so Jest requires it directly.

const TRADEMARK_FIELDS = ['name', 'type', 'description', 'usage', 'link'];

const TRADEMARKS = [
  {
    _id: 'ScanossCpe2pxrk7A',
    name: 'ScanOSS cpe2purl',
    type: 'copyright',
    description: 'ScanOSS maintains a curated list of CPE to PURL matches in a GitHub repository at ' +
      'https://github.com/scanoss/cpe2purl under MIT license.',
    usage: 'We use this data as an additional verification resource to improve our vulnerability matching.',
    link: 'https://github.com/scanoss/cpe2purl'
  }
];

/**
 * One upsert per shipped entry: every field the entry carries is set, and a field
 * it does not carry is unset, so the stored document ends up exactly as shipped.
 *
 * @returns {Array<{selector: Object, modifier: Object}>}
 */
function trademarkUpserts() {
  return TRADEMARKS.map(function (entry) {
    const $set = {};
    const $unset = {};
    TRADEMARK_FIELDS.forEach(function (field) {
      if (typeof entry[field] === 'string' && entry[field] !== '') {
        $set[field] = entry[field];
      } else {
        $unset[field] = '';
      }
    });
    const modifier = {$set: $set};
    if (Object.keys($unset).length) {
      modifier.$unset = $unset;
    }
    return {selector: {_id: entry._id}, modifier: modifier};
  });
}

module.exports = {
  TRADEMARKS,
  TRADEMARK_FIELDS,
  trademarkUpserts
};
