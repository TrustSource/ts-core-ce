// Role decisions for account creation and password verification.
//
// Meteor-free CommonJS so Jest can require it directly
// (test_api/specs/user-roles.unit.spec.js).

// The roles onCreateUser queues for a new account, applied by
// finalizeRegistration once the user document exists.
function rolesForNewUser(options, user) {
  if (options.roles) {
    return Array.isArray(options.roles) ? options.roles : Object.values(options.roles).flat();
  }
  console.log('roles for user %s not set, using ["manager","account_admin"] as default',
    user.emails && user.emails[0] && user.emails[0].address);
  return ['manager', 'account_admin'];
}

// The roles verifyUserPassword migrates into the account's company when it holds
// none there: the pre-Roles-v4 flat `roles` array, and nothing else. Every
// current way into a company assigns roles when the account is created, so an
// account without legacy roles gets none - a default here would make any account
// holding a foreign profile.companyId a member of that company.
function legacyRolesToMigrate(user) {
  if (!user || !Array.isArray(user.roles)) {
    return [];
  }
  return user.roles.filter((role) => typeof role === 'string');
}

// The roles a company owner holds: whoever creates a company by signing up, and
// the first admin seeded at startup.
const COMPANY_OWNER_ROLES = ['developer', 'compliance_manager', 'portfolio_manager', 'manager',
  'account_admin', 'company_component_manager', 'company_security_manager'];

module.exports = {rolesForNewUser, legacyRolesToMigrate, COMPANY_OWNER_ROLES};
