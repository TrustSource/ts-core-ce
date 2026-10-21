/* eslint-disable no-undef */
// Wiring guard for the sign-up trust fixes in imports/startup/server/accounts.js.
//
// The helpers are covered by new-user-server-only-flags.unit.spec.js and
// user-roles.unit.spec.js, but they protect nothing unless accounts.js uses them
// in the right place. onCreateUser cannot run under Jest, so the order is locked
// structurally: the server-only flags are dropped before the `testuser` early
// return, and verifyUserPassword migrates only legacy roles.
//
// Source-assertion pattern: the source files are read as strings.
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '../..');

// Comment-blind assertions would happily pass on commented-out code.
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => (/^\s*\/\//.test(line) ? '' : line))
    .join('\n');
}

const accounts = stripComments(fs.readFileSync(path.join(REPO, 'imports/startup/server/accounts.js'), 'utf8'));

function section(startMarker, endMarker) {
  const start = accounts.indexOf(startMarker);
  const end = accounts.indexOf(endMarker, start + startMarker.length);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return accounts.slice(start, end);
}

describe('onCreateUser drops server-only profile flags from untrusted sign-ups', () => {
  it('imports the helper', () => {
    expect(accounts).toMatch(
      /import\s*\{[^}]*\bwithoutServerOnlyProfileFlags\b[^}]*\}\s*from\s*'\/imports\/lib\/interactors\/users\/protectedProfileFields'/
    );
  });

  it('strips them outside trustedCompanyAssignment, before the testuser early return', () => {
    const hook = section('Accounts.onCreateUser(async function (options, user) {', '\n});');
    const strip = hook.search(
      /if\s*\(\s*!trustedCompanyAssignment\.get\(\)\s*\)\s*\{\s*user\.profile\s*=\s*withoutServerOnlyProfileFlags\(\s*user\.profile\s*\)\s*;?\s*\}/
    );
    const testuserReturn = hook.indexOf('if (user.profile && user.profile.testuser)');
    const profileCopy = hook.search(/user\.profile\s*=\s*options\.profile\s*;/);
    expect(profileCopy).toBeGreaterThan(-1);
    expect(strip).toBeGreaterThan(profileCopy);
    expect(testuserReturn).toBeGreaterThan(strip);
  });
});

describe('verifyUserPassword migrates only legacy roles', () => {
  const method = section('verifyUserPassword: async function', 'getUserInfoByToken: async function');

  it('imports the helper', () => {
    expect(accounts).toMatch(
      /import\s*\{[^}]*\blegacyRolesToMigrate\b[^}]*\}\s*from\s*'\/imports\/server\/userRoles'/
    );
  });

  it('never falls back to a default role', () => {
    expect(method).not.toMatch(/\[\s*'developer'\s*\]/);
  });

  it('assigns only what legacyRolesToMigrate returns', () => {
    expect(method).toMatch(/legacyRolesToMigrate\(\s*user\s*\)/);
    expect(method).toMatch(/setUserRolesAsync\(\s*user\._id\s*,\s*legacyRoles\s*,/);
  });
});
