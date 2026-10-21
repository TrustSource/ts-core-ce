// Client write guard for Meteor.users `profile`.
//
// accounts-base registers its own Meteor.users.allow({update}) that lets a
// client modify ANY sub-key of its own `profile`, and allow-deny accepts a write
// as soon as one allow rule returns true - so the app's stricter allow rule in
// server/collections/users.js never gets to refuse it. `profile` carries
// server-owned fields (companyId decides the tenant every publication and method
// serves, testuser skips the account-status gate, invitedBy, email), so without a
// deny rule a logged-in user could re-home itself into any company from the
// browser console.
//
// Every profile edit in the UI goes through server methods that allowlist their
// own keys (updateUserProfile, updateUserConfig). The only direct client write
// left is the account-activation page (imports/client/ui/account/signup.js),
// which sets the own name and newsletter flag. Everything else touching
// `profile` from the client is denied; server-side updateAsync bypasses
// allow/deny and is unaffected.
//
// CommonJS (no meteor/* imports) so Jest can require it directly - the same
// dual-consumption pattern as companies/protectedFields.js.

const {userNameProblem, normalizeUserName} = require('../../user/nameValidation');

const CLIENT_WRITABLE_PROFILE_FIELDS = ['profile.name', 'profile.newsletter'];

const WRITABLE_SET = new Set(CLIENT_WRITABLE_PROFILE_FIELDS);

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

// Meteor.users.deny({update}) predicate: true means deny. Only decides updates
// whose `fieldNames` (top-level fields, as computed by allow-deny) include
// `profile`; any other update returns false and is left to the allow rules.
// Deliberately sync + boolean so the deny decision is never an always-truthy
// Promise.
function deniesClientProfileWrite(userId, doc, fieldNames, modifier) {
  if (!Array.isArray(fieldNames) || fieldNames.indexOf('profile') === -1) {
    return false;
  }
  if (!userId || !doc || doc._id !== userId || !isPlainObject(modifier)) {
    return true;
  }
  return Object.keys(modifier).some((op) => {
    const params = modifier[op];
    if (!isPlainObject(params)) {
      return true;
    }
    return Object.keys(params).some((key) => {
      if (key.split('.')[0] !== 'profile') {
        return false;
      }
      if (op !== '$set' || !WRITABLE_SET.has(key)) {
        return true;
      }
      // The activation page sends the name trimmed and checked with the same rule;
      // anything else (empty, whitespace-only, padded, invalid) is refused here.
      return key === 'profile.name' &&
        (userNameProblem(params[key]) !== null || params[key] !== normalizeUserName(params[key]));
    });
  });
}

// Sign-up markers only server flows may set. Accounts.onCreateUser copies the
// client's `options.profile` verbatim: `testuser` (fixture accounts) returned
// early with the e-mail marked verified and before the untrusted-companyId
// strip, and `invitedBy` (admin invitations) sends an invitation mail naming that
// user instead of the verification mail. onCreateUser drops both unless the account is
// created inside a trusted server flow.
const SERVER_ONLY_PROFILE_FLAGS = ['testuser', 'invitedBy'];

// Return a shallow copy of `profile` without the server-only flags. A non-object
// profile is returned unchanged; the input is never mutated.
function withoutServerOnlyProfileFlags(profile) {
  if (!isPlainObject(profile)) {
    return profile;
  }
  const out = Object.assign({}, profile);
  SERVER_ONLY_PROFILE_FLAGS.forEach((flag) => {
    delete out[flag];
  });
  return out;
}

module.exports = {
  CLIENT_WRITABLE_PROFILE_FIELDS,
  deniesClientProfileWrite,
  SERVER_ONLY_PROFILE_FLAGS,
  withoutServerOnlyProfileFlags
};
