/* eslint-disable no-undef */
// A version's `paths` entries are plain strings on every analysis the current worker
// writes, and {path} objects on older records. Readers must accept both, or a report
// stores "<module> > undefined" / `paths: [null]`.
const {pathLocation, pathLabel, pathLicenses} = require('../../imports/lib/analysis/pathLocation');

const LOCATION = '/com.example:app:1.0.0/net.minidev:accessors-smart:2.5.2';

describe('pathLocation', () => {
  it('reads the string shape the analysis writes today', () => {
    expect(pathLocation(LOCATION)).toBe(LOCATION);
  });

  it('reads the {path} shape of older records', () => {
    expect(pathLocation({path: LOCATION, licenses: []})).toBe(LOCATION);
  });

  it('keeps a root path', () => {
    expect(pathLocation('/')).toBe('/');
    expect(pathLocation({path: '/'})).toBe('/');
  });

  it.each([undefined, null, '', {}, {path: null}, {path: ''}, {path: 42}, 0])(
    'returns null rather than undefined for %p', (input) => {
      expect(pathLocation(input)).toBeNull();
    });
});

describe('pathLabel', () => {
  it('joins the module and the location', () => {
    expect(pathLabel('app.cdx.json', LOCATION)).toBe('app.cdx.json > ' + LOCATION);
    expect(pathLabel('app.cdx.json', {path: LOCATION})).toBe('app.cdx.json > ' + LOCATION);
  });

  it('falls back to the module alone instead of emitting "undefined"', () => {
    [undefined, null, '', {}, {path: null}].forEach((input) => {
      expect(pathLabel('app.cdx.json', input)).toBe('app.cdx.json');
    });
  });

  it('never produces the literal string undefined', () => {
    [undefined, null, '', {}, {path: null}, LOCATION, {path: LOCATION}].forEach((input) => {
      expect(pathLabel('app.cdx.json', input)).not.toMatch(/undefined/);
    });
  });
});

// Three module views import pathLicenses; while the module did not export it, the import
// was undefined and every render of the dependency aside threw "is not a function".
describe('pathLicenses', () => {
  it('is exported', () => {
    expect(typeof pathLicenses).toBe('function');
  });

  it('reads the annotations of the older {path, licenses} shape', () => {
    const licenses = [{key: 'MIT', status: {status: 'ok'}}];
    expect(pathLicenses({path: LOCATION, licenses})).toBe(licenses);
  });

  it('gives an empty list for the string shape and anything without annotations', () => {
    [LOCATION, '', undefined, null, {}, {path: LOCATION}, {licenses: 'MIT'}].forEach((input) => {
      expect(pathLicenses(input)).toEqual([]);
    });
  });
});
