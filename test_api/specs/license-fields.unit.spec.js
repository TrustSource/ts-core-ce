/* eslint-disable no-undef */
// The Community Edition carries no legal assessment of licenses. Every path that
// sends a license out of the server projects through this one allow-list, so a
// database that still stores `constraints` and friends never leaks them.
const {LICENSE_FIELDS, licenseProjection} = require('../../imports/lib/licenses/licenseFields');

const ASSESSMENT_FIELDS = ['constraints', 'analysed', 'editorial', 'disclaimer'];

describe('LICENSE_FIELDS', () => {
  it('is exactly the catalog metadata', () => {
    expect(LICENSE_FIELDS).toEqual(['key', 'name', 'url', 'aliases', 'text', 'copyright', 'created', 'updated']);
  });

  it('names no assessment field', () => {
    ASSESSMENT_FIELDS.forEach((field) => expect(LICENSE_FIELDS).not.toContain(field));
  });
});

describe('licenseProjection', () => {
  it('includes text only when asked', () => {
    expect(licenseProjection({withText: true}).text).toBe(1);
    expect(licenseProjection({withText: false}).text).toBeUndefined();
  });

  it('defaults to no text', () => {
    expect(licenseProjection().text).toBeUndefined();
    expect(licenseProjection({}).text).toBeUndefined();
  });

  it('is a pure inclusion projection, so an unlisted stored field is never sent', () => {
    const projection = licenseProjection({withText: true});
    expect(Object.keys(projection).sort()).toEqual(LICENSE_FIELDS.slice().sort());
    Object.values(projection).forEach((value) => expect(value).toBe(1));
    ASSESSMENT_FIELDS.forEach((field) => expect(projection[field]).toBeUndefined());
  });

  it('returns a fresh object on every call', () => {
    const first = licenseProjection({withText: true});
    first.constraints = 1;
    expect(licenseProjection({withText: true}).constraints).toBeUndefined();
  });

  it('stays requirable from both bundles', () => {
    const raw = require('fs').readFileSync(
      require('path').join(__dirname, '../../imports/lib/licenses/licenseFields.js'), 'utf8');
    expect(raw).toMatch(/module\.exports\s*=/);
    expect(raw).not.toMatch(/from\s+['"]meteor\//);
  });
});
