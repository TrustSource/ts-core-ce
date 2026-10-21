/* eslint-disable no-undef */
// A catalog that predates a seed entry keeps the row without its license text, because
// the insert is skipped on the taken key. The backfill fills only those gaps.
const {licenseTextsToBackfill} = require('../../imports/lib/licenses/licenseTextBackfill');

const SEED = [
  {key: 'Apache-2.0', name: 'Apache-2.0', url: 'u', text: 'APACHE TEXT'},
  {key: 'MIT', name: 'MIT', url: 'u', text: 'MIT TEXT'}
];

describe('licenseTextsToBackfill', () => {
  it('fills a row that carries no text', () => {
    const out = licenseTextsToBackfill(SEED, [{_id: 'a', key: 'Apache-2.0'}]);
    expect(out).toEqual([{_id: 'a', key: 'Apache-2.0', text: 'APACHE TEXT'}]);
  });

  it.each([null, '', '   '])('treats %p as no text', (text) => {
    const out = licenseTextsToBackfill(SEED, [{_id: 'a', key: 'Apache-2.0', text}]);
    expect(out).toHaveLength(1);
  });

  it('never overwrites a text already in the catalog', () => {
    const out = licenseTextsToBackfill(SEED, [{_id: 'a', key: 'Apache-2.0', text: 'EDITED IN THE UI'}]);
    expect(out).toEqual([]);
  });

  it('matches keys ignoring case, the way license matching does', () => {
    const out = licenseTextsToBackfill(SEED, [{_id: 'a', key: 'apache-2.0'}]);
    expect(out).toEqual([{_id: 'a', key: 'apache-2.0', text: 'APACHE TEXT'}]);
  });

  it('ignores a key the catalog does not carry', () => {
    expect(licenseTextsToBackfill(SEED, [{_id: 'z', key: 'GPL-3.0-only'}])).toEqual([]);
  });

  it('ignores a seed entry that has no text to give', () => {
    const out = licenseTextsToBackfill([{key: 'Apache-2.0', text: ''}], [{_id: 'a', key: 'Apache-2.0'}]);
    expect(out).toEqual([]);
  });

  it('fills each catalog key at most once', () => {
    const out = licenseTextsToBackfill(SEED, [
      {_id: 'a', key: 'Apache-2.0'},
      {_id: 'b', key: 'apache-2.0'}
    ]);
    expect(out).toEqual([{_id: 'a', key: 'Apache-2.0', text: 'APACHE TEXT'}]);
  });

  it.each([[null, null], [undefined, undefined], [[], []]])('survives empty input %p', (a, b) => {
    expect(licenseTextsToBackfill(a, b)).toEqual([]);
  });
});
