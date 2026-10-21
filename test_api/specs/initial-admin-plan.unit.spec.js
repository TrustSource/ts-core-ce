/* eslint-disable no-undef */
// A fresh installation can start with a ready admin: the planner decides whether
// startup seeds one, from the user count and the INITIAL_ADMIN_* settings.
const {planInitialAdmin, DEFAULT_COMPANY_NAME, MIN_PASSWORD_LENGTH} =
  require('../../imports/server/initialAdmin/initialAdminPlan');
const {COMPANY_OWNER_ROLES} = require('../../imports/server/userRoles');

const OK = {userCount: 0, email: 'admin@example.com', password: 'correct-horse', companyName: 'Acme'};

describe('planInitialAdmin', () => {
  it('seeds on an empty database with both settings', () => {
    expect(planInitialAdmin(OK)).toEqual({seed: true, email: 'admin@example.com', companyName: 'Acme'});
  });

  it('never seeds when any user exists', () => {
    expect(planInitialAdmin(Object.assign({}, OK, {userCount: 1}))).toEqual({seed: false, reason: 'users exist'});
  });

  it.each([undefined, null, '', '   '])('skips without an email (%p)', (email) => {
    expect(planInitialAdmin(Object.assign({}, OK, {email}))).toEqual({seed: false, reason: 'INITIAL_ADMIN_EMAIL is not set'});
  });

  it.each([undefined, null, '', '   ', '        ', ' \t\n       '])('skips without a password (%p)', (password) => {
    expect(planInitialAdmin(Object.assign({}, OK, {password}))).toEqual({seed: false, reason: 'INITIAL_ADMIN_PASSWORD is not set'});
  });

  it.each(['admin', 'admin@', '@example.com', 'a b@example.com'])('skips an implausible email (%p)', (email) => {
    expect(planInitialAdmin(Object.assign({}, OK, {email}))).toEqual({seed: false, reason: 'INITIAL_ADMIN_EMAIL is not a valid address'});
  });

  it('skips a short password', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(8);
    expect(planInitialAdmin(Object.assign({}, OK, {password: 'short12'})))
      .toEqual({seed: false, reason: 'INITIAL_ADMIN_PASSWORD must have at least 8 characters'});
  });

  it('trims the email and lowercases it, and trims the company name', () => {
    expect(planInitialAdmin(Object.assign({}, OK, {email: '  Admin@Example.com ', companyName: '  Acme  '})))
      .toEqual({seed: true, email: 'admin@example.com', companyName: 'Acme'});
  });

  it('defaults the company name', () => {
    expect(DEFAULT_COMPANY_NAME).toBe('My company');
    [undefined, '', '   '].forEach((companyName) =>
      expect(planInitialAdmin(Object.assign({}, OK, {companyName})).companyName).toBe('My company'));
  });

  it('never returns the password', () => {
    expect(JSON.stringify(planInitialAdmin(OK))).not.toContain('correct-horse');
  });
});

describe('COMPANY_OWNER_ROLES', () => {
  it('is the company owner role set', () => {
    expect(COMPANY_OWNER_ROLES).toEqual(['developer', 'compliance_manager', 'portfolio_manager', 'manager',
      'account_admin', 'company_component_manager', 'company_security_manager']);
  });
});
