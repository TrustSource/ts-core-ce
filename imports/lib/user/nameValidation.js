// Single source of truth for "is this an acceptable user display name?", shared by
// the SimpleSchema user profile (imports/lib/schemas/userSchema.js), the invite /
// CSV-import server methods that validate against it, and Jest. Plain CommonJS with
// no imports so it loads from Blaze, server code and tests alike.
//
// Allows the punctuation and digits that real names carry - "." (J. Smith), "'"
// (O'Brien), "," (Smith, Jr.) and digits (Team 2 Lead) - while still excluding
// markup characters (< > & " etc.) so a name stays safe wherever it is rendered
// (audit-log text, toasts, Blaze).
const USER_NAME_REGEX = /^[a-zA-Z0-9 À-ÿĄĆĘŁŃŚŹŻąćęłńśźż.,'@_/-]{2,50}$/;

function isValidUserName(name) {
  return typeof name === 'string' && USER_NAME_REGEX.test(name);
}

// Form and method input: surrounding whitespace is not part of the name.
function normalizeUserName(name) {
  return typeof name === 'string' ? name.trim() : '';
}

// What is wrong with a name typed into a form: 'empty' (nothing but whitespace),
// 'invalid' (fails USER_NAME_REGEX after trimming) or null when it can be saved.
// The regex alone lets a whitespace-only name through, and its schema error is
// only a generic "Validation failed" toast, so the Profile and Invite forms and
// their server methods ask this instead and show USER_NAME_MESSAGES[problem].
function userNameProblem(name) {
  if (name !== undefined && name !== null && typeof name !== 'string') {
    return 'invalid';
  }
  const trimmed = normalizeUserName(name);
  if (!trimmed) {
    return 'empty';
  }
  return USER_NAME_REGEX.test(trimmed) ? null : 'invalid';
}

const USER_NAME_MESSAGES = {
  empty: 'Enter a name',
  invalid: 'Use 2 to 50 characters: letters, digits, spaces and . , \' @ _ / -'
};

module.exports = {USER_NAME_REGEX, USER_NAME_MESSAGES, isValidUserName, normalizeUserName, userNameProblem};
