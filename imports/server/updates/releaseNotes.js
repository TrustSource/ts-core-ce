// Release notes shipped with the Community Edition, shown on the Updates page.
//
// Plain CommonJS with no imports, so Jest requires it directly. Add a new entry
// (with a new fixed _id) for each release; startup inserts entries whose _id is
// missing and never changes an existing one, so users' viewedBy marks survive.
//
// The 1.0 entry also carries installationId: generated per process, but stored only
// when the entry is first inserted, so it stays fixed for this database.

const crypto = require('crypto');

// Checked on startup for a newer version: the TrustSource update check, which
// answers {latestVersion}. TS_UPDATE_CHECK_URL points it elsewhere (any endpoint
// answering JSON with `latestVersion`, `tag_name` or `version`), TS_UPDATE_CHECK=false
// turns the check off.
const UPDATE_CHECK_URL = 'https://ce.trustsource.io/update-check';

const RELEASE_NOTES = [
  {
    _id: 'ce-release-1-0',
    version: '1.0',
    published: '2026-09-16T00:00:00.000Z',
    installationId: crypto.randomUUID(),
    listNew: [{description: 'Initial release'}]
  },
  {
    _id: 'ce-release-1-0-1',
    version: '1.0.1',
    published: '2026-10-14T00:00:00.000Z',
    listImprovement: [{description: 'Cleanup'}]
  },
  {
    _id: 'ce-release-1-0-2',
    version: '1.0.2',
    published: '2026-10-20T00:00:00.000Z',
    listImprovement: [{description: 'Update dependencies'}]
  }
];

/**
 * @param {Array<String>} existingIds _ids already in the updates collection
 * @returns {Array<Object>} fresh documents to insert
 */
function releaseNotesToInsert(existingIds) {
  const existing = new Set(existingIds || []);
  return RELEASE_NOTES
    .filter(function (note) { return !existing.has(note._id); })
    .map(function (note) {
      const doc = JSON.parse(JSON.stringify(note));
      doc.published = new Date(note.published);
      doc.created = new Date(note.published);
      return doc;
    });
}

/**
 * @returns {String} version of the most recently published release note
 */
function currentVersion() {
  return RELEASE_NOTES.reduce(function (latest, note) {
    return new Date(note.published) > new Date(latest.published) ? note : latest;
  }, RELEASE_NOTES[0]).version;
}

/**
 * @param {Object} env process.env
 * @returns {{enabled: Boolean, url: String}} whether and where to check for a newer version
 */
function updateCheckSettings(env) {
  const flag = String((env && env.TS_UPDATE_CHECK) || '').trim().toLowerCase();
  const url = String((env && env.TS_UPDATE_CHECK_URL) || '').trim();
  return {
    enabled: flag !== 'false' && flag !== '0' && flag !== 'off',
    url: url || UPDATE_CHECK_URL
  };
}

function versionParts(version) {
  const match = /(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(String(version || ''));
  return match ? [1, 2, 3].map(function (i) { return parseInt(match[i] || '0', 10); }) : null;
}

/**
 * @param {String} current version of this installation, e.g. '1.0.1'
 * @param {Object} data the update check answer ({latestVersion}, {tag_name} or {version})
 * @returns {String|null} the newer version announced by `data`, or null
 */
function newerVersion(current, data) {
  const latest = data && (data.latestVersion || data.tag_name || data.version);
  const a = versionParts(latest);
  const b = versionParts(current);
  if (!a || !b) {
    return null;
  }
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) {
      return a[i] > b[i] ? String(latest).replace(/^v/i, '') : null;
    }
  }
  return null;
}

module.exports = {
  RELEASE_NOTES,
  UPDATE_CHECK_URL,
  releaseNotesToInsert,
  currentVersion,
  updateCheckSettings,
  newerVersion
};
