// Two different questions get asked about a user, and answering them with one function is what
// produced "Dear user@example.com," in the plan dialogs and
// "New user created x@y.com (x@y.com)" in the activity log:
//
//   userRealName(user)    - "what do I call this person?"  May legitimately be empty: only
//                           name-invited users have a profile.name,
//                           the self-service register form never collects one. Callers that
//                           write a salutation should branch on this rather than print a
//                           fallback that is not a name.
//   userAccountName(user) - "which account is this?"       Always present: the login address.
//   userDisplayName(user) - the first that is available, for places where a blank would look
//                           broken (audit-log NAME column, "Dear ...!" in transactional mail).
//
// Plain CommonJS with no imports so it is usable from server code, Blaze helpers and Jest.

function userRealName(user) {
  if (!user || typeof user !== 'object') return '';
  return (user.profile && user.profile.name) || '';
}

function userAccountName(user) {
  if (!user || typeof user !== 'object') return '';
  const profile = user.profile || {};
  const primaryEmail = Array.isArray(user.emails) && user.emails[0] && user.emails[0].address;
  return primaryEmail || profile.email || user.username || '';
}

function userDisplayName(user) {
  return userRealName(user) || userAccountName(user);
}

module.exports = {userRealName, userAccountName, userDisplayName};
