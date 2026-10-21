/* eslint-disable no-undef */
// The user-name regex used to reject digits, periods and apostrophes, so inviting
// "J. Smith", "Team 2 Lead" or "O'Brien" failed with "Name failed regular
// expression validation". This is the single source of truth shared by the
// SimpleSchema user profile and the invite/import server methods.
const fs = require('fs');
const path = require('path');

const {USER_NAME_REGEX, isValidUserName} = require('../../imports/lib/user/nameValidation');

function read(relative) {
  return fs.readFileSync(path.join(__dirname, '../..', relative), 'utf8');
}

describe('isValidUserName - accepts real names', () => {
  it.each([
    'Anna Schmidt',
    'J. Smith',
    "O'Brien",
    'Smith, Jr.',
    'Team 2 Lead',
    'Zoë Müller',       // À-ÿ range
    'Łukasz Wiśniewski', // Polish letters
    'Jean-Luc',          // hyphen
    'AZ'                 // minimum length 2
  ])('accepts %j', (name) => {
    expect(isValidUserName(name)).toBe(true);
  });
});

describe('isValidUserName - rejects unusable or unsafe input', () => {
  it.each([
    ['A', 'shorter than 2 chars'],
    ['', 'empty'],
    ['<script>', 'markup - angle brackets'],
    ['a&b', 'ampersand'],
    ['say "hi"', 'double quote'],
    ['x'.repeat(51), 'longer than 50 chars']
  ])('rejects %j (%s)', (name) => {
    expect(isValidUserName(name)).toBe(false);
  });

  it('rejects non-strings', () => {
    [undefined, null, 42, {}, ['Anna']].forEach((v) => expect(isValidUserName(v)).toBe(false));
  });

  it('keeps out the characters that would break audit-log / toast rendering', () => {
    ['<', '>', '&', '"'].forEach((ch) => {
      expect(USER_NAME_REGEX.test('Ann' + ch + 'a')).toBe(false);
    });
  });
});

describe('the schema uses the shared regex (no second source of truth)', () => {
  it('userSchema imports USER_NAME_REGEX instead of inlining a pattern', () => {
    const src = read('imports/lib/schemas/userSchema.js');
    expect(src).toContain("from '/imports/lib/user/nameValidation'");
    expect(src).toContain('regEx: USER_NAME_REGEX');
  });
});
