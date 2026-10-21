/* eslint-disable no-undef */
// Static-source regression (verify-only): every getUsers* Meteor method
// in imports/server/collections/users.js must return its result through the
// `sanitizeUsers` allow-list (which strips the `services` field - bcrypt hash +
// enroll/reset/login tokens). The behavioral leak itself is covered by
// safe-user-fields.spec.js (the pure sanitizer) and by the live regress harness;
// this guards against a NEW getUsers* method being added without sanitization, or
// an existing one being changed to return a raw cursor.fetch().
//
// Source-text assertion (no Meteor import) so the jest harness can run it without
// a server.
const fs = require('fs');
const path = require('path');

const usersSrc = fs.readFileSync(
  path.join(__dirname, '../../imports/server/collections/users.js'),
  'utf8'
);

// Extract the body of each `getXxx: async function () { ... }` method so we can
// assert on its return statement(s) in isolation.
function methodBody(src, name) {
  const start = src.indexOf(name + ': async function');
  if (start === -1) return null;
  // Walk braces from the first '{' after the signature to its match.
  const open = src.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  return null;
}

const GET_USERS_METHODS = [
  'getUsers',
  'getUsersManagers',
  'getUsersAccountAdmins',
  'getUsersComplianceManagers'
];

describe('#81 getUsers* never returns the services field', () => {
  it('users.js imports the SAFE_USER_FIELDS allow-list + sanitizeUsers', () => {
    expect(usersSrc).toContain('SAFE_USER_FIELDS');
    expect(usersSrc).toContain('sanitizeUsers');
  });

  GET_USERS_METHODS.forEach((name) => {
    describe(name, () => {
      const body = methodBody(usersSrc, name);

      it('is present in users.js', () => {
        expect(body).not.toBeNull();
      });

      it('routes every return through sanitizeUsers (no raw user docs)', () => {
        // Each `return` in the method must hand its value to sanitizeUsers - the
        // role-check early `throw` has no return, so all returns are data returns.
        const returns = (body.match(/return\b/g) || []).length;
        const sanitized = (body.match(/return\s+sanitizeUsers\(/g) || []).length;
        expect(returns).toBeGreaterThan(0);
        expect(sanitized).toBe(returns);
      });

      it('fetches with the SAFE_USER_FIELDS projection (services excluded at the DB layer)', () => {
        expect(body).toContain('SAFE_USER_FIELDS');
      });

      it('never projects in or reads the services field', () => {
        // Allow the word in an explanatory comment, but forbid any actual
        // services projection (`services: 1`) or property access (`.services`).
        const codeOnly = body.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
        expect(codeOnly).not.toMatch(/services\s*:/);
        expect(codeOnly).not.toMatch(/\.services\b/);
      });
    });
  });

  it('the SAFE_USER_FIELDS allow-list itself never lists services', () => {
    const { SAFE_USER_FIELDS } = require('../../imports/server/security/safeUserFields');
    expect(SAFE_USER_FIELDS).not.toHaveProperty('services');
  });
});
