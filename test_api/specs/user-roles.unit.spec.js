/* eslint-disable no-undef */
// Unit tests for imports/server/userRoles.js.

const {rolesForNewUser, legacyRolesToMigrate} = require('../../imports/server/userRoles');

describe('rolesForNewUser', () => {
  let consoleLogSpy;

  beforeEach(() => {
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  it('defaults an account without explicit roles to manager and account_admin', () => {
    const user = {services: {password: {}}, emails: [{address: 'a@example.test'}]};

    expect(rolesForNewUser({}, user)).toEqual(['manager', 'account_admin']);
    expect(consoleLogSpy).toHaveBeenCalledTimes(1);
  });

  it('uses the roles the caller passed, as an array or as a per-scope map', () => {
    const user = {services: {password: {}}};

    expect(rolesForNewUser({roles: ['developer']}, user)).toEqual(['developer']);
    expect(rolesForNewUser({roles: {companyA: ['developer', 'manager']}}, user)).toEqual(['developer', 'manager']);
  });
});

// verifyUserPassword self-heals an account with no roles in its company by
// migrating the pre-Roles-v4 flat `roles` array into that scope. Meteor 3 added
// a `['developer']` fallback for accounts with no legacy roles at all, which
// turned any account holding a foreign profile.companyId into a member of that
// company. Only real legacy data is migrated now; nothing is invented.
describe('legacyRolesToMigrate', () => {
  it('invents no role for an account without legacy roles', () => {
    expect(legacyRolesToMigrate({_id: 'u1', profile: {companyId: 'companyB'}})).toEqual([]);
  });

  it('returns the legacy flat roles array', () => {
    expect(legacyRolesToMigrate({roles: ['developer', 'manager']})).toEqual(['developer', 'manager']);
  });

  it('ignores the per-scope map format and non-string entries', () => {
    expect(legacyRolesToMigrate({roles: {companyB: ['manager']}})).toEqual([]);
    expect(legacyRolesToMigrate({roles: ['developer', null, 42, {}]})).toEqual(['developer']);
  });

  it('returns an empty list for an empty array or a missing user', () => {
    expect(legacyRolesToMigrate({roles: []})).toEqual([]);
    expect(legacyRolesToMigrate(undefined)).toEqual([]);
  });
});
