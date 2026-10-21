/* eslint-disable no-undef */
// `profile.name` is only populated for invited users; the self-service
// register form never collects one. Reading it raw produced "New user created undefined"
// in the activity log.
const fs = require('fs');
const path = require('path');

const {userDisplayName} = require('../../imports/lib/user/displayName');

function read(relative) {
  return fs.readFileSync(path.join(__dirname, '../..', relative), 'utf8');
}

describe('userDisplayName', () => {
  it('prefers profile.name when present', () => {
    expect(userDisplayName({
      profile: {name: 'Anna Schmidt', email: 'anna@example.com'},
      emails: [{address: 'anna@example.com'}]
    })).toBe('Anna Schmidt');
  });

  it('falls back to the primary email address', () => {
    expect(userDisplayName({
      profile: {email: 'fallback@example.com'},
      emails: [{address: 'primary@example.com'}]
    })).toBe('primary@example.com');
  });

  it('falls back to profile.email when there is no emails array', () => {
    expect(userDisplayName({profile: {email: 'profile@example.com'}})).toBe('profile@example.com');
  });

  it('falls back to the login/username as a last resort', () => {
    expect(userDisplayName({username: 'developer', profile: {}})).toBe('developer');
  });

  it('never returns undefined or the string "undefined"', () => {
    [undefined, null, {}, {profile: {}}, {profile: {name: ''}}, 'not-an-object', 42]
      .forEach((value) => {
        const result = userDisplayName(value);
        expect(typeof result).toBe('string');
        expect(result).not.toMatch(/undefined/);
      });
  });

  it('ignores an empty emails array', () => {
    expect(userDisplayName({emails: [], profile: {email: 'x@example.com'}})).toBe('x@example.com');
  });
});

describe('call sites no longer read profile.name raw', () => {
  it('audit-log entries use the fallback', () => {
    const src = read('imports/server/logEvent.js');
    expect(src).toContain("from '/imports/lib/user/displayName'");
    expect(src).toMatch(/options\.userName = userDisplayName\(user\)/);
  });

  it('the "New user created" event never repeats the account address twice', () => {
    // Naming the user and then repeating the address rendered "New user created x@y.com
    // (x@y.com)" for every self-service registration, because the fallback IS the address.
    const src = read('imports/startup/server/accounts.js');
    expect(src).not.toMatch(/'New user created '\+user\.profile\.name/);
    expect(src).toMatch(/userRealName\(user\)/);
    // The name/address pair is only emitted when there really is a name to pair.
    expect(src).toMatch(/createdName \?[^\n]*createdAccount[\s\S]{0,40}:\s*createdAccount/);
  });
});

// ---------------------------------------------------------------------------------------
// Additions (QA automation): the helper was since split into three, because "what do I call
// this person" and "which account is this" are different questions and answering both with a
// single fallback is what produced the duplicated-address log line above.
// ---------------------------------------------------------------------------------------
const {userRealName, userAccountName} = require('../../imports/lib/user/displayName');

describe('userRealName - may legitimately be empty', () => {
  it('returns the profile name when there is one', () => {
    expect(userRealName({profile: {name: 'Anna Schmidt'}, emails: [{address: 'a@b.c'}]}))
      .toBe('Anna Schmidt');
  });

  it('returns EMPTY for a self-service account, never the email address', () => {
    // This is the whole point of the split: a caller writing "Dear X," must be able to tell
    // that there is no name, instead of greeting someone by their login.
    const selfService = {emails: [{address: 'user@example.com'}], profile: {companyId: 'c1'}};
    expect(userRealName(selfService)).toBe('');
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a string', 'nope'],
    ['a number', 7],
    ['an empty object', {}],
    ['an empty profile', {profile: {}}]
  ])('returns an empty string for %s', (_label, value) => {
    expect(userRealName(value)).toBe('');
  });
});

describe('userAccountName - always identifies the account', () => {
  it('prefers the primary email over profile.email', () => {
    expect(userAccountName({emails: [{address: 'primary@x.io'}], profile: {email: 'old@x.io'}}))
      .toBe('primary@x.io');
  });

  it('falls back to profile.email, then to the username', () => {
    expect(userAccountName({profile: {email: 'p@x.io'}})).toBe('p@x.io');
    expect(userAccountName({username: 'developer', profile: {}})).toBe('developer');
  });

  it('ignores an empty emails array', () => {
    expect(userAccountName({emails: [], profile: {email: 'p@x.io'}})).toBe('p@x.io');
  });

  it('ignores a malformed emails entry instead of throwing', () => {
    expect(() => userAccountName({emails: [null], profile: {email: 'p@x.io'}})).not.toThrow();
    expect(userAccountName({emails: [{}], profile: {email: 'p@x.io'}})).toBe('p@x.io');
  });

  it.each([[undefined], [null], ['nope'], [42], [{}]])('returns a string for %p', (value) => {
    expect(typeof userAccountName(value)).toBe('string');
  });
});

describe('the three helpers stay consistent with each other', () => {
  it('userDisplayName is exactly "real name, else account name"', () => {
    const named = {profile: {name: 'Anna'}, emails: [{address: 'a@b.c'}]};
    const anonymous = {profile: {}, emails: [{address: 'a@b.c'}]};
    expect(userDisplayName(named)).toBe(userRealName(named));
    expect(userDisplayName(anonymous)).toBe(userAccountName(anonymous));
  });

  it('never returns undefined or the literal string "undefined"', () => {
    [undefined, null, {}, {profile: {}}, {profile: {name: ''}}, 'not-an-object', 42]
      .forEach((value) => {
        [userRealName, userAccountName, userDisplayName].forEach((fn) => {
          const result = fn(value);
          expect(typeof result).toBe('string');
          expect(result).not.toMatch(/undefined/);
        });
      });
  });

  it('the audit log still uses the never-blank variant', () => {
    const src = read('imports/server/logEvent.js');
    expect(src).toContain("from '/imports/lib/user/displayName'");
    expect(src).toMatch(/options\.userName = userDisplayName\(user\)/);
  });
});
