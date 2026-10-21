/* eslint-disable no-undef */
// The Copyright & Trademarks page shows a static list shipped in code, forced into
// the database on every start.
const {TRADEMARKS, TRADEMARK_FIELDS, trademarkUpserts} = require('../../imports/server/trademarks/trademarksData');

// SimpleSchema.RegEx.Id, which TrademarkSchema applies to _id.
const METEOR_ID = /^[23456789ABCDEFGHJKLMNPQRSTWXYZabcdefghijkmnopqrstuvwxyz]{17}$/;

describe('TRADEMARKS', () => {
  it('ships exactly the ScanOSS cpe2purl entry', () => {
    expect(TRADEMARKS.map((t) => t.name)).toEqual(['ScanOSS cpe2purl']);
  });

  it('matches the approved content', () => {
    expect(TRADEMARKS[0]).toEqual({
      _id: TRADEMARKS[0]._id,
      name: 'ScanOSS cpe2purl',
      type: 'copyright',
      description: 'ScanOSS maintains a curated list of CPE to PURL matches in a GitHub repository at ' +
        'https://github.com/scanoss/cpe2purl under MIT license.',
      usage: 'We use this data as an additional verification resource to improve our vulnerability matching.',
      link: 'https://github.com/scanoss/cpe2purl'
    });
  });

  it('uses fixed, unique Meteor-format ids', () => {
    const ids = TRADEMARKS.map((t) => t._id);
    ids.forEach((id) => expect(id).toMatch(METEOR_ID));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('fits the trademark schema', () => {
    TRADEMARKS.forEach((t) => {
      Object.keys(t).forEach((field) => expect(['_id'].concat(TRADEMARK_FIELDS)).toContain(field));
      expect(['copyright', 'trademark']).toContain(t.type);
      expect(t.description.length).toBeLessThanOrEqual(2000);
      expect(t.usage.length).toBeLessThanOrEqual(2000);
      expect(t.link).toMatch(/^https:\/\//);
    });
  });
});

describe('trademarkUpserts', () => {
  it('upserts each entry by _id and sets every field it carries', () => {
    const [first] = trademarkUpserts();
    expect(first.selector).toEqual({_id: TRADEMARKS[0]._id});
    expect(first.modifier.$set).toEqual({
      name: TRADEMARKS[0].name,
      type: TRADEMARKS[0].type,
      description: TRADEMARKS[0].description,
      usage: TRADEMARKS[0].usage,
      link: TRADEMARKS[0].link
    });
    expect(first.modifier.$unset).toBeUndefined();
  });

  it('returns fresh objects that cannot mutate the shipped data', () => {
    const [first] = trademarkUpserts();
    first.modifier.$set.name = 'changed';
    expect(TRADEMARKS[0].name).toBe('ScanOSS cpe2purl');
  });
});

describe('the module', () => {
  it('uses module.exports and imports nothing from meteor/', () => {
    const raw = require('fs').readFileSync(
      require('path').join(__dirname, '../../imports/server/trademarks/trademarksData.js'), 'utf8');
    expect(raw).toMatch(/module\.exports\s*=/);
    expect(raw).not.toMatch(/from\s+['"]meteor\//);
  });
});
