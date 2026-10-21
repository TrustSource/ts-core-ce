/* eslint-disable no-undef */
// Smaller hardening items, locked structurally (the code paths need a running
// Meteor server):
//
//   - getImpactCve took the company from its caller: a client passing another
//     company's id got that company's affected projects and modules. Only the
//     REST report (server code, company resolved from the API key) may pass one.
//   - password-reset, verification and enrolment mail URLs carry a login token
//     and were written to the server log; RestApi logged a whole user document.
//   - self sign-up had only accounts-base's per-connection limit, which a client
//     side-steps by opening a new connection per call, and no way to turn it off.
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '../..');

function read(rel) {
  return fs.readFileSync(path.join(REPO, rel), 'utf8');
}

// Comment-blind assertions would happily pass on commented-out code.
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => (/^\s*\/\//.test(line) ? '' : line))
    .join('\n');
}

describe('getImpactCve company scope', () => {
  const modules = stripComments(read('imports/server/collections/modules.js'));
  const start = modules.indexOf('getImpactCve: async function');
  const body = modules.slice(start, modules.indexOf('\n  },', start));

  it('ignores a caller-supplied company id on client calls', () => {
    expect(start).toBeGreaterThan(-1);
    expect(body).not.toMatch(/const companyId = extCompanyId \|\|/);
    expect(body).toMatch(/this\.connection\s*\?\s*undefined\s*:\s*extCompanyId/);
  });

  it('never hands the raw argument to the vulnerability lookup either', () => {
    expect(body).not.toMatch(/tsVulnerabilityCveDetails',\s*\{[^}]*\}\s*,\s*extCompanyId\s*\)/);
  });
});

describe('no login tokens or user documents in the server log', () => {
  it('accounts.js never logs a mail URL', () => {
    const accounts = stripComments(read('imports/startup/server/accounts.js'));
    expect(accounts).not.toMatch(/console\.(log|info|warn|error)\([^;]*\burl\b/);
  });

  it('RestApi.js never logs a whole user object', () => {
    const restApi = stripComments(read('imports/server/rest-api/RestApi.js'));
    expect(restApi).not.toMatch(/console\.(log|info|warn|error)\([^;]*,\s*user\s*\)/);
  });
});

describe('self sign-up rate limit', () => {
  // Lift rate-limit.js with a recording DDPRateLimiter.
  const source = read('imports/startup/server/rate-limit.js')
    .replace(/^import[\s\S]*?from\s*'[^']*';[ \t]*$/gm, '');
  const rules = [];
  new Function('DDPRateLimiter', source)({
    addRule(matcher, limit, interval) {
      rules.push({matcher, limit, interval});
    }
  });
  const matchesCreateUser = (matcher) => (typeof matcher.name === 'function'
    ? matcher.name('createUser') : matcher.name === 'createUser');

  it('limits createUser per client address, not only per connection', () => {
    const rule = rules.find((r) => matchesCreateUser(r.matcher) && typeof r.matcher.clientAddress === 'function');
    expect(rule).toBeDefined();
    expect(rule.limit).toBeLessThanOrEqual(10);
    expect(rule.interval).toBeGreaterThanOrEqual(60 * 60 * 1000);
  });
});

describe('self sign-up switch', () => {
  it('reads REGISTRATION_ENABLED, off unless it is the literal "true"', () => {
    expect(stripComments(read('imports/server/config.js')))
      .toMatch(/REGISTRATION_ENABLED:\s*process\.env\.REGISTRATION_ENABLED\s*===\s*'true'/);
  });

  it('treats a missing or unknown setting as off in the shared config too', () => {
    const shared = stripComments(read('imports/config.js'));
    expect(shared).toMatch(/return process\.env\.REGISTRATION_ENABLED\s*===\s*'true';/);
    expect(shared).toMatch(/PUBLIC_SETTINGS\.registrationEnabled\s*===\s*true;/);
    expect(shared).not.toMatch(/!==\s*'false'/);
  });

  it('forbids client account creation when it is off', () => {
    expect(stripComments(read('imports/startup/server/accounts.js')))
      .toMatch(/Accounts\.config\(\{[^}]*forbidClientAccountCreation:\s*!Config\.REGISTRATION_ENABLED/);
  });

  it('publishes the setting to the client and loads that at startup', () => {
    expect(stripComments(read('imports/startup/server/registration.js')))
      .toMatch(/PUBLIC_SETTINGS\.registrationEnabled\s*=\s*Config\.REGISTRATION_ENABLED/);
    expect(stripComments(read('imports/startup/server/index.js'))).toMatch(/import\s+'\.\/registration';/);
  });

  it('hides the register link and redirects /register when it is off', () => {
    expect(read('imports/client/ui/account/login.html'))
      .toMatch(/\{\{#if registrationEnabled\}\}[\s\S]*?id="register"[\s\S]*?\{\{\/if\}\}/);
    expect(stripComments(read('imports/client/ui/account/login.js'))).toMatch(/registrationEnabled\s*[:(]/);
    const router = stripComments(read('imports/lib/router.js'));
    const route = router.slice(router.indexOf("Router.route('/register'"), router.indexOf("Router.route('/scans'"));
    expect(route).toMatch(/Config\.registrationEnabled/);
    expect(route).toMatch(/this\.redirect\(\s*'login'\s*\)/);
  });
});
