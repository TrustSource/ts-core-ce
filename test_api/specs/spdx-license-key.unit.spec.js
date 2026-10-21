/* eslint-disable no-undef */
// SPDX JSON imports used to store licenses with a name but no `key`, and never populated
// `scannedLicenses` - unlike the CycloneDX importer and the SPDX RDF branch, which both run
// applyLicensePreprocessing. That left SPDX-imported scans inconsistent with every other
// ingest path ("declared vs concluded" could not be compared at all).
//
// ImportConverter itself pulls in Meteor absolute imports and cannot be required under Jest,
// so the key-derivation rule is asserted against the extracted pure helper, and the wiring
// (helper used + preprocessing applied on the JSON branch) is asserted on the source.
const fs = require('fs');
const path = require('path');

const {spdxLicenseKey} = require('../../imports/lib/spdx/licenseKey');

const converterSrc = fs.readFileSync(
  path.join(__dirname, '../../imports/server/rest-api/ImportConverter.js'),
  'utf8'
);

describe('spdxLicenseKey - bare identifiers are keys', () => {
  it.each([
    'MIT',
    'Apache-2.0',
    'AGPL-3.0-only',
    'BSD-3-Clause',
    'ISC',
    'Zlib',
    'CC-BY-SA-4.0',
    'GPL-2.0-or-later'
  ])('keys %s', (id) => {
    expect(spdxLicenseKey(id)).toBe(id);
  });
});

describe('spdxLicenseKey - expressions and placeholders are not keys', () => {
  it.each([
    ['compound OR', 'MIT OR Apache-2.0'],
    ['compound AND', 'MIT AND Apache-2.0'],
    ['parenthesised', '(MIT OR Apache-2.0)'],
    ['WITH exception', 'GPL-2.0-only WITH Classpath-exception-2.0'],
    ['plus inside expression', 'MIT OR LGPL-2.1+'],
    ['no assertion', 'NOASSERTION'],
    ['none', 'NONE'],
    ['document-local ref', 'LicenseRef-NordwindProprietary']
  ])('does not key %s', (_label, value) => {
    expect(spdxLicenseKey(value)).toBeUndefined();
  });

  it.each([
    ['empty string', ''],
    ['undefined', undefined],
    ['null', null],
    ['number', 42],
    ['object', {id: 'MIT'}]
  ])('does not key %s', (_label, value) => {
    expect(spdxLicenseKey(value)).toBeUndefined();
  });
});

describe('ImportConverter wiring for the SPDX JSON branch', () => {
  it('derives the license key through the shared helper', () => {
    expect(converterSrc).toContain("from '/imports/lib/spdx/licenseKey'");
    expect(converterSrc).toMatch(/const licenseKey = spdxLicenseKey\(licenseName\)/);
    expect(converterSrc).toMatch(/licenseKey \? \{key: licenseKey, name: licenseName\}/);
  });

  it('runs license preprocessing on the JSON branch, so scannedLicenses is captured', () => {
    // Present on the JSON branch (CycloneDX already had it; RDF applies it inline).
    const jsonBranch = converterSrc.slice(
      converterSrc.indexOf("if(params.format === 'json')"),
      converterSrc.indexOf("}else if(params.format === 'rdf')")
    );
    expect(jsonBranch).toContain('applyLicensePreprocessing');
  });

  it('captures scannedLicenses before licenses are rewritten', () => {
    const fn = converterSrc.slice(
      converterSrc.indexOf('function applyLicensePreprocessing'),
      converterSrc.indexOf('function cyclonedxToScan')
    );
    expect(fn.indexOf('dependency.scannedLicenses'))
      .toBeLessThan(fn.indexOf('dependency.licenses = preProcessLicenses'));
  });
});

// ---------------------------------------------------------------------------------------
// Additions (QA automation): the source-slicing above is only sound while its anchors exist.
// `String.prototype.slice` accepts -1 silently, so a renamed anchor turns a scoped assertion
// into a whole-file one - which can pass for the wrong reason. Pin the anchors first, then
// extend the pure-helper coverage.
// ---------------------------------------------------------------------------------------

describe('ImportConverter slicing anchors are real (guards the assertions above)', () => {
  it.each([
    ["JSON branch opener", "if(params.format === 'json')"],
    ["RDF branch opener", "}else if(params.format === 'rdf')"],
    ['applyLicensePreprocessing declaration', 'function applyLicensePreprocessing'],
    ['cyclonedxToScan declaration', 'function cyclonedxToScan']
  ])('%s is still present in ImportConverter.js', (_label, anchor) => {
    expect(converterSrc.indexOf(anchor)).toBeGreaterThan(-1);
  });

  it('the JSON branch really precedes the RDF branch', () => {
    expect(converterSrc.indexOf("if(params.format === 'json')"))
      .toBeLessThan(converterSrc.indexOf("}else if(params.format === 'rdf')"));
  });

  it('applies the preprocessing to the SPDX JSON dependency tree exactly once', () => {
    // Applying it twice would overwrite `scannedLicenses` with the ALREADY-expanded licenses,
    // silently destroying the "as declared" record the field exists to keep.
    const spdxToScan = converterSrc.slice(
      converterSrc.indexOf('function spdxToScan'),
      converterSrc.indexOf('function spdxJsonToScan') > -1
        ? converterSrc.indexOf('function spdxJsonToScan')
        : converterSrc.length
    );
    expect((spdxToScan.match(/forEach\(applyLicensePreprocessing\)/g) || [])).toHaveLength(1);
  });

  it('the RDF branch still captures scannedLicenses inline (unchanged behaviour)', () => {
    // Opposite direction: the JSON fix must not have removed the RDF path's own handling.
    const rdfDep = converterSrc.slice(converterSrc.indexOf('const spdxComponentToScanDependency'));
    expect(rdfDep.slice(0, 1500)).toMatch(/dependency\.scannedLicenses =/);
  });
});

describe('spdxLicenseKey - the key is the identifier itself', () => {
  it.each(['MIT', 'Apache-2.0', '0BSD', 'GPL-2.0+', 'BSD-2-Clause-Patent'])(
    'returns %s unchanged, not a normalised variant', (id) => {
      expect(spdxLicenseKey(id)).toBe(id);
    });

  it('is idempotent - feeding a derived key back in yields the same key', () => {
    ['MIT', 'Apache-2.0', '0BSD'].forEach((id) => {
      expect(spdxLicenseKey(spdxLicenseKey(id))).toBe(id);
    });
  });

  it('accepts identifiers starting with a digit (0BSD is a real SPDX id)', () => {
    expect(spdxLicenseKey('0BSD')).toBe('0BSD');
  });

  it('accepts the deprecated trailing-plus form used by older SPDX documents', () => {
    expect(spdxLicenseKey('GPL-2.0+')).toBe('GPL-2.0+');
    expect(spdxLicenseKey('LGPL-2.1+')).toBe('LGPL-2.1+');
  });
});

describe('spdxLicenseKey - whitespace and stray characters are not identifiers', () => {
  it.each([
    ['leading space', ' MIT'],
    ['trailing space', 'MIT '],
    ['inner tab', 'MIT\tOR\tApache-2.0'],
    ['trailing newline', 'MIT\n'],
    ['a trademark symbol', 'MIT™'],
    ['a slash', 'MIT/Apache-2.0'],
    ['a comma-separated list', 'MIT,Apache-2.0'],
    ['a leading dot', '.MIT'],
    ['a leading dash', '-MIT'],
    ['a leading plus', '+MIT'],
    ['a bare LicenseRef prefix', 'LicenseRef-'],
    ['a colon-qualified ref', 'DocumentRef-x:LicenseRef-y']
  ])('does not key %s', (_label, value) => {
    expect(spdxLicenseKey(value)).toBeUndefined();
  });
});

describe('spdxLicenseKey - documented case-sensitivity boundary', () => {
  // SPDX defines NOASSERTION, NONE and the LicenseRef- prefix with exactly this casing, and
  // license identifiers are themselves case-sensitive. A lowercase spelling is therefore an
  // out-of-spec document, and it IS keyed today. Recorded so the behaviour is a decision
  // rather than an accident; see the report's Notes.
  it.each(['noassertion', 'none', 'licenseRef-Foo', 'DocumentRef-external'])(
    'keys the out-of-spec spelling %s', (value) => {
      expect(spdxLicenseKey(value)).toBe(value);
    });

  it('still rejects the canonical spellings', () => {
    expect(spdxLicenseKey('NOASSERTION')).toBeUndefined();
    expect(spdxLicenseKey('NONE')).toBeUndefined();
    expect(spdxLicenseKey('LicenseRef-Foo')).toBeUndefined();
  });
});
