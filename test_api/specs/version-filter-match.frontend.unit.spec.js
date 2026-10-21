// A filter box above every versions table. The match rule is the
// behaviour worth pinning, so it lives in a meteor-free CommonJS module Jest
// can require directly (same split as async-search-phases). The ReactiveVar /
// Session wiring on top - page reset, selection clearing - is verified in the
// browser.
const {
  matchVersions,
  readVersionString
} = require('../../imports/client/ui/common/version-search/versionMatch');

// Index records (component-detail-idx) carry a plain `version` field.
const record = version => ({version});
// The Version model (every other versions table) exposes getVersion().
const model = version => ({getVersion: () => version});

describe('#124 version filter matching', () => {
  const versions = ['2.1.0', '2.1.4', '12.1.0', '1.0.0'].map(record);

  it('matches a version substring anywhere in the string', () => {
    expect(matchVersions(versions, '2.1').map(v => v.version))
      .toEqual(['2.1.0', '2.1.4', '12.1.0']);
  });

  it('returns the list untouched for an empty or blank term', () => {
    expect(matchVersions(versions, '')).toBe(versions);
    expect(matchVersions(versions, '   ')).toBe(versions);
    expect(matchVersions(versions, null)).toBe(versions);
    expect(matchVersions(versions, undefined)).toBe(versions);
  });

  it('ignores surrounding whitespace in the term', () => {
    expect(matchVersions(versions, '  1.0.0 ').map(v => v.version)).toEqual(['1.0.0']);
  });

  it('is case-insensitive, for versions that are not all digits', () => {
    const tagged = ['1.0.0-RC1', '1.0.0-rc2', '1.0.0'].map(record);
    expect(matchVersions(tagged, 'rc').map(v => v.version))
      .toEqual(['1.0.0-RC1', '1.0.0-rc2']);
    expect(matchVersions(tagged, 'RC').map(v => v.version))
      .toEqual(['1.0.0-RC1', '1.0.0-rc2']);
  });

  it('handles non-semver versions, which whole ecosystems use', () => {
    // apk appends a package revision; nuget builds four-part versions.
    const apk = ['1.2.3-r4', '1.2.3-r5'].map(record);
    expect(matchVersions(apk, '-r5').map(v => v.version)).toEqual(['1.2.3-r5']);
    const nuget = ['4.5.0.1', '4.5.0.2'].map(record);
    expect(matchVersions(nuget, '4.5.0.').map(v => v.version)).toEqual(['4.5.0.1', '4.5.0.2']);
  });

  it('reads Version model objects as well as plain index records', () => {
    const mixed = [model('3.0.0'), record('3.1.0'), model('4.0.0')];
    expect(matchVersions(mixed, '3.').map(readVersionString)).toEqual(['3.0.0', '3.1.0']);
  });

  it('yields nothing rather than throwing on a term that matches none', () => {
    expect(matchVersions(versions, 'nope')).toEqual([]);
  });

  it('survives a missing or malformed list, which a cold load can hand it', () => {
    expect(matchVersions(undefined, '1')).toEqual([]);
    expect(matchVersions(null, '1')).toEqual([]);
    expect(matchVersions('not a list', '1')).toEqual([]);
  });

  it('skips entries with no version at all instead of throwing', () => {
    expect(matchVersions([null, {}, record('9.9.9')], '9').map(v => v.version))
      .toEqual(['9.9.9']);
  });
});
