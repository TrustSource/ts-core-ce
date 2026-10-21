/* eslint-disable no-undef */
// Pure unit test for the sign-up profile markers only server flows may set. No
// Meteor, no running app - requires the dependency-free CommonJS module directly.
//
// Why it exists: Accounts.onCreateUser copies the client's `options.profile`
// verbatim. `testuser` made onCreateUser return early with the e-mail marked
// verified and BEFORE the untrusted-companyId strip, so an anonymous
//   createUser({email, password, profile: {testuser: true, companyId: '<victim>'}})
// produced a logged-in account inside any company. `invitedBy` swaps the
// verification mail for an invitation naming whichever user id the client sent.
//
// Contract: withoutServerOnlyProfileFlags(profile) returns a shallow copy without
// SERVER_ONLY_PROFILE_FLAGS. onCreateUser applies it unless the account is
// created inside a trusted server flow (admin invitation).
const {
  SERVER_ONLY_PROFILE_FLAGS,
  withoutServerOnlyProfileFlags
} = require('../../imports/lib/interactors/users/protectedProfileFields');

describe('SERVER_ONLY_PROFILE_FLAGS', () => {
  it('is exactly the fixture marker and the invitation marker', () => {
    expect(SERVER_ONLY_PROFILE_FLAGS).toEqual(['testuser', 'invitedBy']);
  });
});

describe('withoutServerOnlyProfileFlags', () => {
  it('drops testuser from the sign-up payload that planted an account in another company', () => {
    const profile = {name: 'Mallory', testuser: true, companyId: 'victimCompany0001'};
    expect(withoutServerOnlyProfileFlags(profile)).toEqual({name: 'Mallory', companyId: 'victimCompany0001'});
  });

  it('drops invitedBy, which would skip the verification mail and name another user', () => {
    const profile = {name: 'Mallory', invitedBy: 'someUserId000001'};
    expect(withoutServerOnlyProfileFlags(profile)).toEqual({name: 'Mallory'});
  });

  it('keeps every other profile key, including a falsy-valued flag being absent afterwards', () => {
    const profile = {name: 'Alice', email: 'a@example.test', notifications: ['EVENTS_ALL'], testuser: false};
    const out = withoutServerOnlyProfileFlags(profile);
    expect(out).toEqual({name: 'Alice', email: 'a@example.test', notifications: ['EVENTS_ALL']});
    expect('testuser' in out).toBe(false);
  });

  it('never mutates its input', () => {
    const profile = {name: 'Mallory', testuser: true};
    const out = withoutServerOnlyProfileFlags(profile);
    expect(profile).toEqual({name: 'Mallory', testuser: true});
    expect(out).not.toBe(profile);
  });

  it('returns a non-object profile unchanged', () => {
    expect(withoutServerOnlyProfileFlags(undefined)).toBeUndefined();
    expect(withoutServerOnlyProfileFlags(null)).toBeNull();
    expect(withoutServerOnlyProfileFlags('x')).toBe('x');
  });
});
