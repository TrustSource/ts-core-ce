/* eslint-disable no-undef */
// Companion to keyFromPurl.spec.js. That spec covers the headline fix (an SPDX document name
// is no longer split into an invented `nordwind:` package type). This one covers the edges
// around it: the shared package-type list the fix now depends on, the input shapes an SPDX
// document actually produces, repeated application, and - crucially - validation against the
// REAL component-key regex rather than a looser one re-typed into the spec.
//
// `imports/lib/utils.js` cannot be required under Jest (Meteor imports), so the regex is
// rebuilt from the exact expression in its source with the shared list substituted in. If the
// production expression changes, this spec follows it; if the expression disappears, the
// extraction fails loudly instead of silently asserting nothing.
const {clearSpdxKey, splitComponentKey} = require('../../imports/lib/component/keyFromPurl');
const {
  ALLOWED_PACKAGE_TYPES, DEFAULT_PACKAGE_TYPE, isAllowedPackageType
} = require('../../imports/lib/component/packageTypes');
const {readSource, readSourceWithoutComments} = require('../helpers/loadMeteorModule');

// --- rebuild Utils.ComponentRegExp.KEY from utils.js source ------------------------------
const utilsSrc = readSource('imports/lib/utils.js');
const keyRegExpExpr = utilsSrc.match(/Utils\.ComponentRegExp\.KEY\s*=\s*new RegExp\(([\s\S]*?)\);/);
if (!keyRegExpExpr) {
  throw new Error('Could not locate Utils.ComponentRegExp.KEY in imports/lib/utils.js - ' +
    'the spec must be updated to follow it, not silently skipped.');
}
// eslint-disable-next-line no-new-func
const COMPONENT_KEY = new Function('Utils',
  'return new RegExp(' + keyRegExpExpr[1] + ');'
)({getAllowedPackageTypes: ALLOWED_PACKAGE_TYPES});

describe('the shared package-type list underpins key validation', () => {
  it('was extracted into a Meteor-free module both sides can read', () => {
    expect(Array.isArray(ALLOWED_PACKAGE_TYPES)).toBe(true);
    expect(ALLOWED_PACKAGE_TYPES.length).toBeGreaterThan(0);
  });

  it('utils.js re-exports it instead of keeping a second copy', () => {
    const src = readSourceWithoutComments('imports/lib/utils.js');
    expect(src).toMatch(/import\s+\{[^}]*ALLOWED_PACKAGE_TYPES[^}]*\}\s+from\s+'\/imports\/lib\/component\/packageTypes'/);
    expect(src).toMatch(/Utils\.getAllowedPackageTypes\s*=\s*ALLOWED_PACKAGE_TYPES/);
    // Opposite direction: the inline literal array must be gone, not merely shadowed.
    expect(src).not.toMatch(/Utils\.getAllowedPackageTypes\s*=\s*\[/);
  });

  it('the API schema still derives its regexes from the same list', () => {
    const src = readSourceWithoutComments('imports/server/rest-api/apiSchema.js');
    expect((src.match(/Utils\.getAllowedPackageTypes/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  it('keyFromPurl derives its prefix decision from the same list', () => {
    const src = readSourceWithoutComments('imports/lib/component/keyFromPurl.js');
    expect(src).toMatch(/require\('\.\/packageTypes'\)/);
    expect(src).toMatch(/isAllowedPackageType\(/);
  });

  // The default prefix MUST itself be a legal type, or every fallback key clearSpdxKey emits
  // is rejected by the very validation this fix exists to satisfy.
  it('the fallback prefix is itself an allowed package type', () => {
    expect(ALLOWED_PACKAGE_TYPES).toContain(DEFAULT_PACKAGE_TYPE);
    expect(isAllowedPackageType(DEFAULT_PACKAGE_TYPE)).toBe(true);
  });

  it('contains no duplicates (a duplicate silently bloats every derived regex)', () => {
    expect(ALLOWED_PACKAGE_TYPES).toHaveLength(new Set(ALLOWED_PACKAGE_TYPES).size);
  });

  it('every entry is a non-empty lowercase token with no separator characters', () => {
    ALLOWED_PACKAGE_TYPES.forEach((type) => {
      expect(typeof type).toBe('string');
      expect(type).not.toBe('');
      expect(type).toBe(type.toLowerCase());
      // A type containing "-" could never be recognised by the split-on-first-"-" rule,
      // and a ":" would break the key grammar outright.
      expect(type).not.toMatch(/[-:\s]/);
    });
  });
});

describe('isAllowedPackageType', () => {
  it('accepts every listed type', () => {
    ALLOWED_PACKAGE_TYPES.forEach((type) => expect(isAllowedPackageType(type)).toBe(true));
  });

  it.each([
    ['unknown word', 'nordwind'],
    ['uppercase variant', 'NPM'],
    ['mixed case variant', 'Maven'],
    ['padded', ' npm'],
    ['empty string', '']
  ])('rejects %s', (_label, value) => {
    expect(isAllowedPackageType(value)).toBe(false);
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a number', 42],
    ['an object', {}],
    ['an array', ['npm']]
  ])('rejects %s without throwing', (_label, value) => {
    expect(() => isAllowedPackageType(value)).not.toThrow();
    expect(isAllowedPackageType(value)).toBe(false);
  });

  it('is not fooled by inherited Object properties', () => {
    ['constructor', 'toString', '__proto__', 'hasOwnProperty'].forEach((name) => {
      expect(isAllowedPackageType(name)).toBe(false);
    });
  });
});

describe('clearSpdxKey - leading separators SPDX identifiers carry', () => {
  it.each([
    ['a leading dash before a real type', '-npm-lodash', 'npm:lodash'],
    ['a leading colon before a real type', ':npm-lodash', 'npm:lodash'],
    ['both, in that order', '-:npm-lodash', 'npm:lodash'],
    ['a leading dash before a plain name', '-nordwind-mobile-app', 'generic:nordwind-mobile-app']
  ])('normalises %s', (_label, input, expected) => {
    expect(clearSpdxKey(input)).toBe(expected);
  });
});

describe('clearSpdxKey - prefix promotion is case-sensitive and exact', () => {
  it('promotes an exact lowercase type', () => {
    expect(clearSpdxKey('pip-Django')).toBe('pip:Django');
    expect(clearSpdxKey('deb-libssl1.1')).toBe('deb:libssl1.1');
    expect(clearSpdxKey('oci-nginx')).toBe('oci:nginx');
  });

  it('does NOT promote an uppercase spelling of a real type', () => {
    // Documented behaviour: only the canonical lowercase token is a package type, so an
    // uppercase head keeps the whole name and takes the neutral prefix.
    expect(clearSpdxKey('NPM-lodash')).toBe('generic:NPM-lodash');
    expect(clearSpdxKey('Maven-org.foo')).toBe('generic:Maven-org.foo');
  });

  it('promotes a type that happens to prefix the package name', () => {
    // "go" is a real type, so "go-lang-thing" reads as go:lang-thing. Recorded so a future
    // change to this ambiguity is a deliberate one.
    expect(clearSpdxKey('go-lang-thing')).toBe('go:lang-thing');
    expect(clearSpdxKey('generic-generic-foo')).toBe('generic:generic-foo');
  });

  it('does not promote an SPDX element-id prefix', () => {
    expect(clearSpdxKey('SPDXRef-Package-lodash')).toBe('generic:SPDXRef-Package-lodash');
    expect(clearSpdxKey('DocumentRef-external')).toBe('generic:DocumentRef-external');
  });

  it('promotes only the FIRST segment, keeping the rest of the name intact', () => {
    expect(clearSpdxKey('npm-a-b-c')).toBe('npm:a-b-c');
    expect(splitComponentKey('npm:a-b-c')).toMatchObject({manager: 'npm', name: 'a-b-c'});
  });
});

describe('clearSpdxKey - already-keyed input is left alone', () => {
  it.each([
    'npm:lodash',
    'maven:org.foo:bar',
    'generic:nordwind-mobile-app',
    'nordwind:mobile-app'
  ])('returns %s unchanged', (key) => {
    expect(clearSpdxKey(key)).toBe(key);
  });

  it('is idempotent for every shape it produces (repeated use is safe)', () => {
    ['nordwind-mobile-app', 'npm-lodash', 'standalone', 'go-lang-thing', '-npm-lodash']
      .forEach((raw) => {
        const once = clearSpdxKey(raw);
        expect(clearSpdxKey(once)).toBe(once);
      });
  });
});

describe('clearSpdxKey - degenerate input no longer throws', () => {
  // The previous implementation called key.match() unguarded, so a missing SPDXID and name
  // crashed the whole import instead of yielding a keyless component.
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['empty string', '']
  ])('passes %s through without throwing', (_label, value) => {
    expect(() => clearSpdxKey(value)).not.toThrow();
    expect(clearSpdxKey(value)).toBe(value);
  });
});

describe('clearSpdxKey - output against the real component-key regex', () => {
  const REAL_SPDX_NAMES = [
    'nordwind-mobile-app',
    'my-company-internal-lib',
    'standalone',
    'npm-lodash',
    'maven-org.foo.bar',
    'golang-github.com-user-repo',
    'generic-zlib',
    'SPDXRef-Package-lodash',
    'pip-Django',
    'deb-libssl1.1'
  ];

  it('the extracted regex behaves like the production one on known-good keys', () => {
    // Sanity-check the extraction itself before relying on it below.
    expect(COMPONENT_KEY.test('npm:lodash')).toBe(true);
    expect(COMPONENT_KEY.test('maven:org.foo:bar')).toBe(true);
    expect(COMPONENT_KEY.test('nordwind:mobile-app')).toBe(false);  // the bug this fix removed
  });

  it.each(REAL_SPDX_NAMES)('turns %s into a key the API accepts', (raw) => {
    expect(clearSpdxKey(raw)).toMatch(COMPONENT_KEY);
  });

  // Known residual limitation, asserted so it is visible rather than assumed fixed:
  // clearSpdxKey only guarantees a legal PREFIX. A name whose remaining characters fall
  // outside the key grammar still produces a key the API will reject.
  it.each([
    ['a scoped npm name', '@babel/core'],
    ['a name with a space', 'my package'],
    ['an empty tail after a real type', 'npm-'],
    ['an empty identifier', ''],
    ['a double leading colon', '::maven-a']
  ])('does NOT rescue %s (still outside the key grammar)', (_label, raw) => {
    expect(clearSpdxKey(raw)).not.toMatch(COMPONENT_KEY);
  });
});
