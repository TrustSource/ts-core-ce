// Single source of truth for the non-sensitive Meteor.users fields that may be
// returned to a company member.
//
// Critically EXCLUDES the `services` field, which holds:
//   • services.password.bcrypt              - password hash (offline cracking)
//   • services.password.enroll.token        - enrollment token  → resetPassword → ATO
//   • services.password.reset.token         - password-reset token → ATO
//   • services.email.verificationTokens[]   - email verification bypass
//   • services.resume.loginTokens[]         - active session tokens
//
// Returning any of these lets a company member take over other accounts, so the
// only safe approach is an allow-list. Mirrors the projection already used by the
// `companyUsers` / `userDetails` publications. `_id` is always returned by Mongo.
//
// CommonJS so the pure sanitizer can be unit-tested by the jest harness while
// remaining importable from Meteor ESM code.

const SAFE_USER_FIELD_NAMES = ['_id', 'createdAt', 'profile', 'emails'];

// Mongo find() projection form (an allow-list - never mix with exclusions).
const SAFE_USER_FIELDS = { createdAt: 1, profile: 1, emails: 1 };

// Defense-in-depth: reduce a user document to the safe allow-list regardless of
// how it was fetched, guarding any code path that forgets the DB projection.
function sanitizeUser(user) {
  if (!user || typeof user !== 'object') return user;
  const safe = {};
  for (const key of SAFE_USER_FIELD_NAMES) {
    if (Object.prototype.hasOwnProperty.call(user, key)) {
      safe[key] = user[key];
    }
  }
  return safe;
}

function sanitizeUsers(users) {
  return Array.isArray(users) ? users.map(sanitizeUser) : users;
}

module.exports = {
  SAFE_USER_FIELD_NAMES,
  SAFE_USER_FIELDS,
  sanitizeUser,
  sanitizeUsers
};
