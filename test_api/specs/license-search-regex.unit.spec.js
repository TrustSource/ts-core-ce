/* eslint-disable no-undef */
// License search text reaching MongoDB as a regular expression.
//
// searchRegExp (used by Licenses.search on the server and by the highlight helper in the
// browser) built its pattern from the raw search words, so the words ran as regex syntax:
// `.` matched every name, an unbalanced `[` threw, and a nested quantifier such as `(a+)+`
// burned database CPU. searchTermsRegExp escapes every word; the pattern still matches any
// of the words (or a "quoted phrase") anywhere in the name, case-insensitively.
const fs = require('fs');
const path = require('path');
const {
  SEARCH_TEXT_MAX_LENGTH,
  escapeRegex,
  searchTermsRegExp
} = require('../../imports/lib/security/searchRegex');

const REPO = path.join(__dirname, '../..');

describe('searchTermsRegExp', () => {
  const matches = (query, text) => {
    const regex = searchTermsRegExp(query);
    regex.lastIndex = 0;
    return regex.test(text);
  };

  it('matches any of the words, anywhere, ignoring case', () => {
    expect(matches('apache license', 'Apache License 2.0')).toBe(true);
    expect(matches('gpl', 'GNU General Public License v3 (GPL)')).toBe(true);
    expect(matches('mit bsd', 'BSD 3-Clause')).toBe(true);
    expect(matches('mozilla', 'MIT License')).toBe(false);
  });

  it('splits on spaces, hyphens and colons, as before', () => {
    expect(searchTermsRegExp('GPL-2.0 or:later').source).toBe('(GPL|2\\.0|or|later)');
  });

  it('keeps a quoted phrase together', () => {
    expect(matches('"Public License"', 'GNU General Public License')).toBe(true);
    expect(matches('"License Public"', 'GNU General Public License')).toBe(false);
  });

  it('treats regex syntax as literal text', () => {
    expect(matches('.', 'MIT License')).toBe(false);
    expect(matches('.*', 'MIT License')).toBe(false);
    expect(matches('a|b', 'Apache')).toBe(false);
    expect(matches('2.0', 'Apache License 2.0')).toBe(true);
    expect(matches('2.0', 'Apache License 210')).toBe(false);
    expect(matches('(GPL)', 'Licensed (GPL) text')).toBe(true);
  });

  it('does not throw on an unbalanced bracket or parenthesis', () => {
    ['[', '(', ')', '[a-', '\\', '{2,}', '+', '?', '*'].forEach((query) => {
      expect(() => searchTermsRegExp(query)).not.toThrow();
    });
  });

  it('turns a catastrophic pattern into literal text', () => {
    const regex = searchTermsRegExp('(a+)+$');
    expect(regex.source).toBe('(\\(a\\+\\)\\+\\$)');
    const started = Date.now();
    regex.test('a'.repeat(5000) + '!');
    expect(Date.now() - started).toBeLessThan(200);
  });

  it('caps the text it builds a pattern from', () => {
    const regex = searchTermsRegExp('x'.repeat(SEARCH_TEXT_MAX_LENGTH * 5));
    expect(regex.source.length).toBeLessThanOrEqual(SEARCH_TEXT_MAX_LENGTH + 2);
  });

  it('matches nothing for empty or non-string input', () => {
    ['', '   ', null, undefined, {$ne: null}, 42].forEach((query) => {
      const regex = searchTermsRegExp(query);
      expect(regex.test('MIT License')).toBe(false);
    });
  });

  it('escapes the same characters as Utils.escapeRegex', () => {
    expect(escapeRegex('a.b*c?d+e(f)g[h]i{j}k|l^m$n\\o/p-q')).toBe(
      'a\\.b\\*c\\?d\\+e\\(f\\)g\\[h\\]i\\{j\\}k\\|l\\^m\\$n\\\\o\\/p\\-q');
  });
});

describe('searchRegExp delegates to the escaping builder', () => {
  it('imports searchTermsRegExp instead of building its own pattern', () => {
    const src = fs.readFileSync(path.join(REPO, 'imports/lib/searchRegExp.js'), 'utf8');
    expect(src).toMatch(/import\s*\{\s*searchTermsRegExp\s*\}\s*from\s*'\/imports\/lib\/security\/searchRegex'/);
    expect(src).not.toMatch(/new RegExp/);
  });
});
