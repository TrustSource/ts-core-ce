/* eslint-disable no-undef */
// The three catch-all catalogue entries a compliance manager can
// pick when a scan produced no license at all.
//
// The list is ONE module (imports/lib/licenseResolution/catchAllLicenses.js)
// because two consumers read it: the startup seed
// (imports/startup/server/fixtures.js) and the client-side picker, which has to
// pin the same three keys into its "Special cases" optgroup. A forked copy is
// how the picker ends up offering a key the catalogue does not carry.
//
// The seeds are catalog metadata only: the Community Edition carries no legal
// assessment of licenses.
const catchAll = require('../../imports/lib/licenseResolution/catchAllLicenses');

const {
  CATCH_ALL_LICENSE_KEYS,
  CATCH_ALL_LICENSE_SEEDS,
  NO_LICENSE_ID,
  isCatchAllLicenseKey
} = catchAll;

function seed(key) {
  return CATCH_ALL_LICENSE_SEEDS.find((s) => s.key === key);
}

describe('CATCH_ALL_LICENSE_KEYS', () => {
  it('is exactly the three keys the product decision named', () => {
    expect(CATCH_ALL_LICENSE_KEYS).toEqual(['NO-LICENSE', 'PUBLIC-DOMAIN', 'UNKNOWN']);
  });

  it('has one seed per key, in the same order', () => {
    expect(CATCH_ALL_LICENSE_SEEDS.map((s) => s.key)).toEqual(CATCH_ALL_LICENSE_KEYS);
  });

  it('recognises its own keys and nothing else', () => {
    CATCH_ALL_LICENSE_KEYS.forEach((key) => expect(isCatchAllLicenseKey(key)).toBe(true));
    expect(isCatchAllLicenseKey('MIT')).toBe(false);
    expect(isCatchAllLicenseKey('no-license')).toBe(false);
    // A component key is user content: an inherited member name must not read
    // as one of ours.
    expect(isCatchAllLicenseKey('constructor')).toBe(false);
    expect(isCatchAllLicenseKey('__proto__')).toBe(false);
    [null, undefined, 0, {}, [], ['MIT']].forEach((v) =>
      expect(isCatchAllLicenseKey(v)).toBe(false));
  });
});

describe('every seed is a storable catalogue entry', () => {
  CATCH_ALL_LICENSE_KEYS.forEach((key) => {
    describe(key, () => {
      const spec = seed(key);

      it('carries a key, a display name and explanatory text', () => {
        expect(spec.key).toBe(key);
        expect(typeof spec.name).toBe('string');
        expect(spec.name.length).toBeGreaterThan(0);
        expect(typeof spec.text).toBe('string');
        expect(spec.text.length).toBeGreaterThan(0);
      });

      it('carries only catalog fields, no legal assessment', () => {
        Object.keys(spec).forEach((field) => expect(['_id', 'key', 'name', 'text']).toContain(field));
      });

      it('fits the catalogue string bounds', () => {
        expect(spec.name.length).toBeLessThanOrEqual(100);
        expect(spec.key.length).toBeLessThanOrEqual(100);
      });
    });
  });
});

describe('ids and exports', () => {
  it('NO-LICENSE keeps the fixed _id the catalogue already stores it under', () => {
    expect(NO_LICENSE_ID).toBe('55a787fd4a2774e3664f9663');
    expect(seed('NO-LICENSE')._id).toBe(NO_LICENSE_ID);
    expect(seed('PUBLIC-DOMAIN')._id).toBeUndefined();
    expect(seed('UNKNOWN')._id).toBeUndefined();
  });

  it('exports no constraint vocabulary', () => {
    expect(Object.keys(catchAll).sort()).toEqual(
      ['CATCH_ALL_LICENSE_KEYS', 'CATCH_ALL_LICENSE_SEEDS', 'NO_LICENSE_ID', 'isCatchAllLicenseKey']);
  });
});

describe('the module stays requirable from both bundles', () => {
  const fs = require('fs');
  const path = require('path');
  const raw = fs.readFileSync(
    path.join(__dirname, '../../imports/lib/licenseResolution/catchAllLicenses.js'), 'utf8');

  it('imports nothing from meteor/ and nothing server-only (AC27)', () => {
    expect(raw).not.toMatch(/require\(\s*['"]meteor\//);
    expect(raw).not.toMatch(/from\s+['"]meteor\//);
    expect(raw).not.toMatch(/imports\/server\//);
  });

  it('uses module.exports so require() works under Jest', () => {
    expect(raw).toMatch(/module\.exports\s*=/);
    expect(raw).not.toMatch(/^\s*export\s/m);
  });
});
