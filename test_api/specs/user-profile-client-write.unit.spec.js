/* eslint-disable no-undef */
// Pure unit test for the Meteor.users client-write guard. No Meteor, no running
// app - requires the dependency-free CommonJS module directly (same pattern as
// company-protected-fields.unit.spec.js).
//
// Why it exists: accounts-base registers its own Meteor.users.allow({update})
// that lets a client modify ANY sub-key of its own `profile`, and allow-deny
// accepts a write as soon as one allow rule returns true. Without a deny rule a
// logged-in user could run, from the browser console,
//   Meteor.users.update(myId, {$set: {'profile.companyId': '<other company>'}})
// and every company-scoped publication and method would then serve that company.
//
// Contract: deniesClientProfileWrite(userId, doc, fieldNames, modifier) is the
// Meteor.users.deny({update}) predicate. When the client update touches
// `profile`, it returns true (deny) unless the update is a `$set` on the caller's
// OWN document and every profile key is in CLIENT_WRITABLE_PROFILE_FIELDS. Updates
// that do not touch `profile` return false and are left to the allow rules.
const {
  CLIENT_WRITABLE_PROFILE_FIELDS,
  deniesClientProfileWrite
} = require('../../imports/lib/interactors/users/protectedProfileFields');

const ME = 'userAAAAAAAAAAAAA';
const OTHER = 'userBBBBBBBBBBBBB';
const ownDoc = {_id: ME};

describe('CLIENT_WRITABLE_PROFILE_FIELDS', () => {
  it('is exactly the two fields the account-activation page writes', () => {
    expect(CLIENT_WRITABLE_PROFILE_FIELDS).toEqual(['profile.name', 'profile.newsletter']);
  });
});

describe('deniesClientProfileWrite', () => {
  it('denies a client moving itself into another company via profile.companyId', () => {
    const modifier = {$set: {'profile.companyId': 'victimCompany0001'}};
    expect(deniesClientProfileWrite(ME, ownDoc, ['profile'], modifier)).toBe(true);
  });

  it.each(['profile.testuser', 'profile.invitedBy', 'profile.email', 'profile.login'])(
    'denies $set of the non-writable profile field %s on the own document',
    (key) => {
      expect(deniesClientProfileWrite(ME, ownDoc, ['profile'], {$set: {[key]: 'x'}})).toBe(true);
    }
  );

  it('denies replacing the whole profile object, which would overwrite companyId', () => {
    const modifier = {$set: {profile: {name: 'Mallory', companyId: 'victimCompany0001'}}};
    expect(deniesClientProfileWrite(ME, ownDoc, ['profile'], modifier)).toBe(true);
  });

  it.each(['$unset', '$inc', '$push', '$addToSet', '$pull', '$pullAll', '$pop', '$bit'])(
    'denies %s on a profile path, even an otherwise writable one',
    (op) => {
      expect(deniesClientProfileWrite(ME, ownDoc, ['profile'], {[op]: {'profile.companyId': 1}})).toBe(true);
      expect(deniesClientProfileWrite(ME, ownDoc, ['profile'], {[op]: {'profile.name': 1}})).toBe(true);
    }
  );

  it('denies a $set that mixes a writable key with a forbidden one', () => {
    const modifier = {$set: {'profile.name': 'Mallory', 'profile.companyId': 'victimCompany0001'}};
    expect(deniesClientProfileWrite(ME, ownDoc, ['profile'], modifier)).toBe(true);
  });

  it('denies writing another user\'s profile, even a writable key', () => {
    const modifier = {$set: {'profile.name': 'renamed'}};
    expect(deniesClientProfileWrite(ME, {_id: OTHER}, ['profile'], modifier)).toBe(true);
  });

  it('allows the account-activation write of the own name and newsletter flag', () => {
    const modifier = {$set: {'profile.newsletter': true, 'profile.name': 'Alice'}};
    expect(deniesClientProfileWrite(ME, ownDoc, ['profile'], modifier)).toBe(false);
  });

  it('does not decide updates that leave profile alone (the allow rules do)', () => {
    expect(deniesClientProfileWrite(ME, ownDoc, ['intro'], {$set: {'intro.chat': true}})).toBe(false);
    expect(deniesClientProfileWrite(ME, ownDoc, ['licenseConfig'], {$set: {licenseConfig: {}}})).toBe(false);
  });

  it('fails closed on a malformed modifier or document when profile is touched', () => {
    expect(deniesClientProfileWrite(ME, ownDoc, ['profile'], null)).toBe(true);
    expect(deniesClientProfileWrite(ME, ownDoc, ['profile'], {$set: 'profile.name'})).toBe(true);
    expect(deniesClientProfileWrite(ME, undefined, ['profile'], {$set: {'profile.name': 'x'}})).toBe(true);
    expect(deniesClientProfileWrite(null, {_id: null}, ['profile'], {$set: {'profile.name': 'x'}})).toBe(true);
  });

  it('returns a plain boolean, never a Promise (a Promise would always deny)', () => {
    const result = deniesClientProfileWrite(ME, ownDoc, ['profile'], {$set: {'profile.name': 'x'}});
    expect(typeof result).toBe('boolean');
  });
});
