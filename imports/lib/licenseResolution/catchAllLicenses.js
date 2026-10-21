// The catch-all catalogue entries a compliance manager may pick when a scan
// could not determine a component's license at all.
//
// ONE module, read by TWO consumers that must never drift apart: the startup seed
// (imports/startup/server/fixtures.js) and the client-side license picker,
// which pins these three keys into its "Special cases" optgroup and excludes
// them from the standard list so they are not offered twice. A forked copy of
// the key list is how the picker ends up offering a key the catalogue does not
// carry.
//
// Plain CommonJS with no imports, so Jest requires it directly and the browser
// bundle can carry it. Nothing server-only may ever be added here.
//
// The seeds are catalog metadata only: the Community Edition carries no legal
// assessment of licenses.

// The catalogue already stores No-License under this id on every existing
// database. The seed must reuse it rather than mint a second document.
const NO_LICENSE_ID = '55a787fd4a2774e3664f9663';

const CATCH_ALL_LICENSE_KEYS = ['NO-LICENSE', 'PUBLIC-DOMAIN', 'UNKNOWN'];

// A Set, not an array scan or an object literal: a component key or a license
// key is scanner content and `constructor` / `__proto__` must not read as one
// of ours.
const CATCH_ALL_KEY_SET = new Set(CATCH_ALL_LICENSE_KEYS);

function isCatchAllLicenseKey(key) {
  return typeof key === 'string' && CATCH_ALL_KEY_SET.has(key);
}

const CATCH_ALL_LICENSE_SEEDS = [
  {
    _id: NO_LICENSE_ID,
    key: 'NO-LICENSE',
    name: 'No-License',
    text: 'This license may be used if a component has no explicit license defined. ' +
      'Do not confuse it with a component whose license is not known - use "UNKNOWN" for that.'
  },
  {
    key: 'PUBLIC-DOMAIN',
    name: 'Public Domain',
    text: 'Use this when the rights holder has placed the component in the public domain ' +
      'or waived all rights to it. Every right is granted and no obligation applies.'
  },
  {
    key: 'UNKNOWN',
    name: 'Unknown',
    text: 'Use this when the license of the component could not be determined. It records ' +
      'that the question was investigated and left open - it is not a statement that the ' +
      'component may be used freely.'
  }
];

module.exports = {
  CATCH_ALL_LICENSE_KEYS,
  CATCH_ALL_LICENSE_SEEDS,
  NO_LICENSE_ID,
  isCatchAllLicenseKey
};
