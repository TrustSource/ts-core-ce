/* eslint-disable no-undef */
// User-typed search text reaching MongoDB as a $regex.
//
// The component search sources built `'^.*' + searchText + '.*$'`, so the text
// ran as a pattern: `.` matched every name, an unbalanced `(` or `[` failed the
// query, and a catastrophic pattern burned CPU against the global component
// catalog. getImpactCve did the same with a CVE id. containsTextRegex turns the
// text into a case-insensitive "contains" condition in which every character is
// literal, capped in length.
const fs = require('fs');
const path = require('path');
const {
  SEARCH_TEXT_MAX_LENGTH,
  containsTextRegex
} = require('../../imports/lib/security/searchRegex');

const REPO = path.join(__dirname, '../..');

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => (/^\s*\/\//.test(line) ? '' : line))
    .join('\n');
}

function asRegExp(condition) {
  return new RegExp(condition.$regex, condition.$options);
}

describe('containsTextRegex', () => {
  it('matches the text literally, case-insensitively', () => {
    const dot = asRegExp(containsTextRegex('.'));
    expect(dot.test('lodash.merge')).toBe(true);
    expect(dot.test('@angular/animations')).toBe(false);
    expect(asRegExp(containsTextRegex('Angular')).test('@angular/cdk')).toBe(true);
    expect(containsTextRegex('x').$options).toBe('i');
  });

  it.each(['(unclosed[', 'a|b', '^$', '\\', '[a-z]+', '{2,}', 'c++', 'pkg:npm/@scope/name?x=1'])(
    'keeps %p a valid pattern that only matches itself',
    (text) => {
      const regex = asRegExp(containsTextRegex(text));
      expect(regex.test(`before ${text} after`)).toBe(true);
    }
  );

  it('neutralises a catastrophic-backtracking pattern', () => {
    const regex = asRegExp(containsTextRegex('(a+)+$'));
    const started = Date.now();
    expect(regex.test('a'.repeat(40) + '!')).toBe(false);
    expect(Date.now() - started).toBeLessThan(50);
  });

  it('caps the searched text', () => {
    const long = 'a'.repeat(SEARCH_TEXT_MAX_LENGTH * 5);
    expect(containsTextRegex(long).$regex).toBe('a'.repeat(SEARCH_TEXT_MAX_LENGTH));
  });

  it('returns null for anything that is not a non-empty string', () => {
    [undefined, null, '', 42, {$ne: null}, ['a']].forEach((value) => {
      expect(containsTextRegex(value)).toBeNull();
    });
  });
});

describe('search sources and getImpactCve use it', () => {
  const components = stripComments(fs.readFileSync(path.join(REPO, 'imports/server/collections/components.js'), 'utf8'));
  const modules = stripComments(fs.readFileSync(path.join(REPO, 'imports/server/collections/modules.js'), 'utf8'));

  it('no server collection file concatenates input into a $regex any more', () => {
    expect(components).not.toMatch(/'\$regex'\s*:\s*'\^\.\*'\s*\+/);
    expect(modules).not.toMatch(/'\$regex'\s*:\s*'\^\.\*'\s*\+/);
  });

  it('components.js builds both search conditions with containsTextRegex', () => {
    expect(components).toMatch(/import\s*\{[^}]*\bcontainsTextRegex\b[^}]*\}\s*from\s*'\/imports\/lib\/security\/searchRegex'/);
    expect((components.match(/containsTextRegex\(\s*searchText\s*\)/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  it('getImpactCve matches the CVE id literally', () => {
    expect(modules).toMatch(/import\s*\{[^}]*\bcontainsTextRegex\b[^}]*\}\s*from\s*'\/imports\/lib\/security\/searchRegex'/);
    const start = modules.indexOf('getImpactCve: async function');
    const body = modules.slice(start, modules.indexOf('\n  },', start));
    expect(body).toMatch(/'message'\s*:\s*containsTextRegex\(\s*cveId\s*\)/);
  });
});
