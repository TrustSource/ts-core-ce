/* eslint-disable no-undef */
// Papa Parse (header:true) emits a trailing all-empty object for the final CSV
// newline. Counting it as a bad row made every import report one phantom
// "Please enter Name and Email" error. Both importUsers and checkImportUsers now
// skip blank rows via this shared helper.
const fs = require('fs');
const path = require('path');

const {isBlankImportRow} = require('../../imports/lib/user/importRow');

function read(relative) {
  return fs.readFileSync(path.join(__dirname, '../..', relative), 'utf8');
}

describe('isBlankImportRow', () => {
  it('treats Papa Parse\'s trailing all-empty object as blank', () => {
    expect(isBlankImportRow({matchID: '', Name: '', Email: '', Company: '', Roles: ''})).toBe(true);
  });

  it('treats whitespace-only cells as blank', () => {
    expect(isBlankImportRow({Name: '  ', Email: '\t', Roles: ' '})).toBe(true);
  });

  it('treats null/undefined/empty object/non-object as blank', () => {
    [null, undefined, {}, 'nope', 42].forEach((v) => expect(isBlankImportRow(v)).toBe(true));
  });

  it('keeps a row that has any real value', () => {
    expect(isBlankImportRow({Name: 'Anna', Email: '', Roles: ''})).toBe(false);
    expect(isBlankImportRow({Name: '', Email: 'a@example.com'})).toBe(false);
    expect(isBlankImportRow({matchID: 'ID001', Name: '', Email: '', Roles: ''})).toBe(false);
  });
});

describe('both import paths use the shared skip', () => {
  it('users.js imports and applies isBlankImportRow in both loops', () => {
    const src = read('imports/server/collections/users.js');
    expect(src).toContain("from '/imports/lib/user/importRow'");
    const applied = src.match(/if \(isBlankImportRow\(user\)\) continue;/g) || [];
    expect(applied.length).toBe(2); // importUsers + checkImportUsers
  });

  it('checkImportUsers no longer writes roles (preview is read-only)', () => {
    const src = read('imports/server/collections/users.js');
    const check = src.slice(src.indexOf('async checkImportUsers'));
    expect(check).not.toContain('setUserRolesAsync');
    expect(check).not.toContain('removeUsersFromRolesAsync');
  });
});
