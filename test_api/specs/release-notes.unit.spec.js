/* eslint-disable no-undef */
// Release notes shipped with the app are inserted once each (by fixed _id) so a new
// installation shows them on the Updates page. An existing entry is never touched,
// which keeps its viewedBy list.
const fs = require('fs');
const path = require('path');
const {RELEASE_NOTES, UPDATE_CHECK_URL, releaseNotesToInsert, currentVersion, updateCheckSettings, newerVersion} = require('../../imports/server/updates/releaseNotes');

describe('RELEASE_NOTES', () => {
  it('starts with 1.0, the initial release', () => {
    expect(RELEASE_NOTES.map((n) => n.version)).toEqual(['1.0', '1.0.1', '1.0.2']);
    expect(RELEASE_NOTES[0].listNew).toEqual([{description: 'Initial release'}]);
  });

  it('every entry has a unique fixed id, a version and a valid published date', () => {
    const ids = RELEASE_NOTES.map((n) => n._id);
    expect(new Set(ids).size).toBe(ids.length);
    RELEASE_NOTES.forEach((n) => {
      expect(typeof n._id).toBe('string');
      expect(n._id.length).toBeGreaterThan(0);
      expect(typeof n.version).toBe('string');
      expect(Number.isNaN(new Date(n.published).getTime())).toBe(false);
    });
  });
});

describe('1.0.1 release note', () => {
  const note = RELEASE_NOTES.find((n) => n.version === '1.0.1');
  const texts = (list) => (note[list] || []).map((item) => item.description);

  it('is a single cleanup improvement', () => {
    expect(texts('listImprovement')).toEqual(['Cleanup']);
    expect(texts('listNew')).toEqual([]);
    expect(texts('listFix')).toEqual([]);
  });

  it('uses no em-dash or en-dash', () => {
    ['listNew', 'listImprovement', 'listFix'].forEach((list) => {
      texts(list).forEach((t) => expect(t).not.toMatch(/[\u2013\u2014]/));
    });
  });
});

describe('1.0.2 release note', () => {
  const note = RELEASE_NOTES.find((n) => n.version === '1.0.2');
  const texts = (list) => ((note && note[list]) || []).map((item) => item.description);
  const readVersion = (file) => JSON.parse(fs.readFileSync(path.join(__dirname, '../..', file), 'utf8')).version;

  it('exists with its own fixed id, published after 1.0.1', () => {
    expect(note).toBeDefined();
    expect(note._id).toBe('ce-release-1-0-2');
    const previous = RELEASE_NOTES.find((n) => n.version === '1.0.1');
    expect(new Date(note.published) > new Date(previous.published)).toBe(true);
  });

  it('matches the app and workers package versions', () => {
    expect(readVersion('package.json')).toBe('1.0.2');
    expect(readVersion('workers/package.json')).toBe(readVersion('package.json'));
    expect(currentVersion()).toBe(readVersion('package.json'));
  });

  it('is a single dependency-update improvement', () => {
    expect(texts('listImprovement')).toEqual(['Update dependencies']);
    expect(texts('listNew')).toEqual([]);
    expect(texts('listFix')).toEqual([]);
  });

  it('uses no em-dash or en-dash', () => {
    ['listNew', 'listImprovement', 'listFix'].forEach((list) => {
      texts(list).forEach((t) => expect(t).not.toMatch(/[\u2013\u2014]/));
    });
  });
});

describe('releaseNotesToInsert', () => {
  it('returns every entry for an empty collection, as storable documents', () => {
    const docs = releaseNotesToInsert([]);
    expect(docs.map((d) => d._id)).toEqual(RELEASE_NOTES.map((n) => n._id));
    docs.forEach((d) => {
      expect(d.published instanceof Date).toBe(true);
      expect(d.created instanceof Date).toBe(true);
      expect(d.viewedBy).toBeUndefined();
    });
  });

  it('skips entries that already exist', () => {
    expect(releaseNotesToInsert(RELEASE_NOTES.map((n) => n._id))).toEqual([]);
  });

  it('gives the 1.0 entry a unique installation id', () => {
    const [doc] = releaseNotesToInsert([]);
    expect(doc._id).toBe('ce-release-1-0');
    expect(doc.installationId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('never hands out the shipped objects', () => {
    const [doc] = releaseNotesToInsert([]);
    doc.listNew.push({description: 'changed'});
    expect(RELEASE_NOTES[0].listNew).toEqual([{description: 'Initial release'}]);
  });
});

describe('currentVersion', () => {
  it('is the version of the most recently published release note', () => {
    expect(currentVersion()).toBe('1.0.2');
  });
});

describe('UPDATE_CHECK_URL', () => {
  it('is an https URL', () => {
    expect(new URL(UPDATE_CHECK_URL).protocol).toBe('https:');
  });
});

describe('updateCheckSettings', () => {
  it('checks the default URL unless configured', () => {
    expect(updateCheckSettings({})).toEqual({enabled: true, url: UPDATE_CHECK_URL});
  });

  it('can be turned off', () => {
    ['false', 'FALSE', '0', 'off'].forEach((value) => {
      expect(updateCheckSettings({TS_UPDATE_CHECK: value}).enabled).toBe(false);
    });
    expect(updateCheckSettings({TS_UPDATE_CHECK: 'true'}).enabled).toBe(true);
  });

  it('takes the URL from TS_UPDATE_CHECK_URL', () => {
    expect(updateCheckSettings({TS_UPDATE_CHECK_URL: ' https://example.com/latest '}).url)
      .toBe('https://example.com/latest');
  });
});

describe('newerVersion', () => {
  it('returns the announced version when it is newer', () => {
    expect(newerVersion('1.0', {tag_name: 'v1.0.1'})).toBe('1.0.1');
    expect(newerVersion('1.0.1', {version: '1.2.0'})).toBe('1.2.0');
    expect(newerVersion('1.9.9', {tag_name: '2.0.0'})).toBe('2.0.0');
    expect(newerVersion('1.0.2', {latestVersion: '1.0.3'})).toBe('1.0.3');
  });

  it('returns null for the same or an older version', () => {
    expect(newerVersion('1.0', {tag_name: 'v1.0.0'})).toBeNull();
    expect(newerVersion('1.2.0', {tag_name: '1.1.9'})).toBeNull();
    expect(newerVersion('1.0.2', {latestVersion: '0.0.0'})).toBeNull();
  });

  it('returns null for an answer without a version', () => {
    expect(newerVersion('1.0', null)).toBeNull();
    expect(newerVersion('1.0', {})).toBeNull();
    expect(newerVersion('1.0', {tag_name: 'latest'})).toBeNull();
  });
});
