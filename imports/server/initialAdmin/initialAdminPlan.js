// Whether startup seeds the first admin of a fresh installation.
//
// Plain CommonJS with no imports, so Jest requires it directly. The runner
// (imports/startup/server/initialAdmin.js) supplies the user count and the
// INITIAL_ADMIN_* settings and acts on the answer. The password is checked but never
// returned, so nothing downstream of the plan can log it.

const DEFAULT_COMPANY_NAME = 'My company';
const MIN_PASSWORD_LENGTH = 8;
// Same shape as the inviteUser check in imports/startup/server/accounts.js -
// bounded character classes only, so it is not flagged as a slow/backtracking regex.
const EMAIL_PATTERN = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

function isBlank(value) {
  return typeof value !== 'string' || value.trim() === '';
}

/**
 * @param {{userCount: Number, email: String, password: String, companyName: String}} input
 * @returns {{seed: false, reason: String}|{seed: true, email: String, companyName: String}}
 */
function planInitialAdmin(input) {
  if (input.userCount > 0) {
    return {seed: false, reason: 'users exist'};
  }
  if (isBlank(input.email)) {
    return {seed: false, reason: 'INITIAL_ADMIN_EMAIL is not set'};
  }
  // A password of only whitespace counts as not set, whatever its length.
  if (isBlank(input.password)) {
    return {seed: false, reason: 'INITIAL_ADMIN_PASSWORD is not set'};
  }
  const email = input.email.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email)) {
    return {seed: false, reason: 'INITIAL_ADMIN_EMAIL is not a valid address'};
  }
  if (input.password.length < MIN_PASSWORD_LENGTH) {
    return {seed: false, reason: 'INITIAL_ADMIN_PASSWORD must have at least ' + MIN_PASSWORD_LENGTH + ' characters'};
  }
  const companyName = isBlank(input.companyName) ? DEFAULT_COMPANY_NAME : input.companyName.trim();
  return {seed: true, email: email, companyName: companyName};
}

module.exports = {
  DEFAULT_COMPANY_NAME,
  MIN_PASSWORD_LENGTH,
  planInitialAdmin
};
