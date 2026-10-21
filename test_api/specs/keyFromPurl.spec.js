/* eslint-disable no-undef */
const {
  purlToKey,
  keyFromParsedPurl,
  splitComponentKey,
  clearSpdxKey
} = require('../../imports/lib/component/keyFromPurl');

describe('keyFromPurl util', () => {
  describe('purlToKey - preserves namespace for 3-part keys', () => {
    it('github purl with org+repo → 3-part key', () => {
      expect(purlToKey('pkg:github/freerdp/freerdp@1.0.0')).toBe('github:freerdp:freerdp');
    });
    it('maven purl with groupId → 3-part key', () => {
      expect(purlToKey('pkg:maven/org.springframework/spring-core@5.0.0'))
        .toBe('maven:org.springframework:spring-core');
    });
    it('npm purl without namespace → 2-part key', () => {
      expect(purlToKey('pkg:npm/lodash@4.17.21')).toBe('npm:lodash');
    });
    it('scoped npm purl → 3-part key', () => {
      expect(purlToKey('pkg:npm/%40angular/core@15.0.0')).toBe('npm:@angular:core');
    });
  });

  describe('purlToKey - bomRef fallback when no purl', () => {
    it('uses bomRef if it already looks like type:ns:name', () => {
      expect(purlToKey(null, 'github', 'freerdp', 'github:freerdp:freerdp'))
        .toBe('github:freerdp:freerdp');
    });
    it('uses bomRef if it looks like type:name', () => {
      expect(purlToKey(null, 'npm', 'lodash', 'npm:lodash')).toBe('npm:lodash');
    });
    it('ignores bomRef that is not in key format (e.g. "lodash@4.17.21")', () => {
      expect(purlToKey(null, 'npm', 'lodash', 'lodash@4.17.21')).toBe('npm:lodash');
    });
    it('falls back to pkgType:name when no purl and no bomRef', () => {
      expect(purlToKey(null, 'npm', 'lodash')).toBe('npm:lodash');
    });
    it('falls back to pkgType:name when purl is malformed', () => {
      expect(purlToKey('not-a-purl', 'github', 'freerdp')).toBe('github:freerdp');
    });
  });

  describe('keyFromParsedPurl - single source of truth', () => {
    it('3-part when namespace present', () => {
      expect(keyFromParsedPurl({type: 'github', namespace: 'freerdp', name: 'freerdp'}))
        .toBe('github:freerdp:freerdp');
    });
    it('2-part when namespace is null', () => {
      expect(keyFromParsedPurl({type: 'npm', namespace: null, name: 'lodash'})).toBe('npm:lodash');
    });
    it('2-part when namespace is undefined', () => {
      expect(keyFromParsedPurl({type: 'npm', name: 'lodash'})).toBe('npm:lodash');
    });
    it('returns null if type or name missing', () => {
      expect(keyFromParsedPurl({type: 'npm'})).toBeNull();
      expect(keyFromParsedPurl(null)).toBeNull();
    });
  });

  describe('splitComponentKey - inverse of purl→key', () => {
    it('splits 3-part key', () => {
      expect(splitComponentKey('github:freerdp:freerdp'))
        .toEqual({manager: 'github', namespace: 'freerdp', name: 'freerdp'});
    });
    it('splits maven 3-part key with dots in namespace', () => {
      expect(splitComponentKey('maven:org.springframework:spring-core'))
        .toEqual({manager: 'maven', namespace: 'org.springframework', name: 'spring-core'});
    });
    it('splits 2-part key (no namespace)', () => {
      expect(splitComponentKey('npm:lodash'))
        .toEqual({manager: 'npm', namespace: null, name: 'lodash'});
    });
    it('returns null for empty / single-part input', () => {
      expect(splitComponentKey('lodash')).toBeNull();
      expect(splitComponentKey('')).toBeNull();
      expect(splitComponentKey(null)).toBeNull();
    });
  });

  describe('clearSpdxKey - unchanged behavior', () => {
    it('strips leading dash', () => {
      expect(clearSpdxKey('-github:freerdp:freerdp')).toBe('github:freerdp:freerdp');
    });
    it('strips leading colon', () => {
      expect(clearSpdxKey(':github:freerdp')).toBe('github:freerdp');
    });
    it('passes through valid 3-part key', () => {
      expect(clearSpdxKey('github:freerdp:freerdp')).toBe('github:freerdp:freerdp');
    });
    it('converts first "-" to ":" for keys without any colon', () => {
      expect(clearSpdxKey('npm-lodash')).toBe('npm:lodash');
    });
    it('preserves remaining dashes in 2-part fallback', () => {
      expect(clearSpdxKey('npm-some-name')).toBe('npm:some-name');
    });
  });

  // An SPDX document name is not a package type. Splitting it on the first "-" invented
  // prefixes like "nordwind:mobile-app", which matched no package type and failed the
  // component-key validation the import API reports as a warning.
  describe('clearSpdxKey - only real package types become a prefix', () => {
    it('does not invent a package type from an arbitrary hyphenated name', () => {
      expect(clearSpdxKey('nordwind-mobile-app')).toBe('generic:nordwind-mobile-app');
    });
    it('keeps the whole name when the head is not a known type', () => {
      expect(clearSpdxKey('my-company-internal-lib')).toBe('generic:my-company-internal-lib');
    });
    it('prefixes a name with no dash at all', () => {
      expect(clearSpdxKey('standalone')).toBe('generic:standalone');
    });
    it('still promotes every known package type', () => {
      expect(clearSpdxKey('maven-org.foo.bar')).toBe('maven:org.foo.bar');
      expect(clearSpdxKey('golang-github.com-user-repo')).toBe('golang:github.com-user-repo');
      expect(clearSpdxKey('generic-zlib')).toBe('generic:zlib');
    });
    it('leaves an already-prefixed key untouched', () => {
      expect(clearSpdxKey('npm:nordwind-mobile-app')).toBe('npm:nordwind-mobile-app');
    });
    it('produces keys that satisfy the component-key format', () => {
      const {ALLOWED_PACKAGE_TYPES} = require('../../imports/lib/component/packageTypes');
      const keyFormat = new RegExp('^(' + ALLOWED_PACKAGE_TYPES.join('|') + '):.+$');
      ['nordwind-mobile-app', 'npm-lodash', 'standalone', 'my-company-internal-lib']
        .forEach((raw) => expect(clearSpdxKey(raw)).toMatch(keyFormat));
    });
  });
});
