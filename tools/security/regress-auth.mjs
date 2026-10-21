// Authentication & account-flow regression for the DDP auth guard + rate limits.
// Run: node tools/security/regress-auth.mjs        (requires the dev server up)
//
// Covers the surface introduced by:
//   imports/startup/server/security-guard.js  (central DDP auth guard + allowlist)
//   imports/startup/server/rate-limit.js       (per-IP / per-connection auth throttling)
//   imports/startup/server/accounts.js          (string-guarded token/email flows)
//
// Asserts, with NO seeded user required:
//   1. Every allowlisted PUBLIC method passes the guard (not a 401 "Authentication required").
//   2. A sample of sensitive non-allowlisted methods are blocked for anon.
//   3. `forgotPassword` is NOT allowlisted (the enumeration oracle is closed; the app
//      uses resetUserPassword instead) -> anon call is guard-blocked.
//   4. Pre-login token/email methods tolerate hostile (operator-injection) input without
//      a server crash (clean error, never a 500 / unhandled).
//
// With a seeded user (DDP_TEST_EMAIL / DDP_TEST_PASSWORD): a positive login check.
// With REGRESS_RATE_LIMIT=1: hammers `login` to prove throttling kicks in. This is
//   OFF by default because it trips the per-IP 20/min rule and briefly throttles all
//   auth methods from this host.
import {DDPClient, isAuthGuard401, isDenied, isThrottled, errCode} from './ddp-client.mjs';

const LOGIN_EMAIL = process.env.DDP_TEST_EMAIL;
const LOGIN_PASSWORD = process.env.DDP_TEST_PASSWORD;

// Mirrors PUBLIC_METHODS in security-guard.js. Each must pass the guard.
const ALLOWLISTED = [
  'logout', 'logoutOtherClients', 'getNewToken', 'removeOtherTokens',
  'resetPassword', 'verifyEmail', 'createUser', 'resendVerificationEmail',
  'getUserInfoByToken', 'resetPasswordByToken',
  'resetUserPassword', 'verifyUserPassword', 'logEvent'
];

// Sensitive methods that MUST require auth (sample of the guarded surface).
const MUST_BE_BLOCKED = [
  'getCompanyCurrent', 'getModulesHistory',
  'tsCsafUpload', 'getProjectObligations'
];

// Pre-login methods that take a client token/email -> feed them hostile input.
const INJECTION_PROBES = [
  ['getUserInfoByToken', [{$ne: null}]],
  ['resetPasswordByToken', [{$ne: null}, 'x']],
  ['resetUserPassword', [{$gt: ''}]],
  ['verifyUserPassword', [{$ne: null}, 'x']]
];

async function main() {
  const c = await new DDPClient().connect();
  let pass = 0, fail = 0;
  const check = (cond, label) => { if (cond) { pass++; console.log('  PASS', label); } else { fail++; console.log('  FAIL', label); } };

  console.log('-- allowlisted public methods pass the guard --');
  for (const m of ALLOWLISTED) {
    const r = await c.call(m, ['__probe__']);
    // pass == not blocked by the auth guard (a business-logic error is fine/expected)
    check(!isAuthGuard401(r), `${m} not guard-blocked (got ${errCode(r) || 'ok'})`);
  }

  console.log('-- sensitive methods blocked for anon --');
  for (const m of MUST_BE_BLOCKED) {
    const r = await c.call(m, ['x', 'y']);
    check(isDenied(r), `${m} blocked (got ${errCode(r) || 'ok'})`);
  }

  console.log('-- enumeration oracle closed (forgotPassword not allowlisted) --');
  {
    const r = await c.call('forgotPassword', [{email: 'nobody@example.com'}]);
    check(isAuthGuard401(r), `forgotPassword guard-blocked for anon (got ${errCode(r) || 'ok'})`);
  }

  console.log('-- pre-login flows survive operator-injection input --');
  for (const [m, params] of INJECTION_PROBES) {
    const r = await c.call(m, params);
    // Acceptable: a clean error or a benign result. NOT acceptable: a 500/internal.
    const code = errCode(r);
    const internal = code === '500' || /internal server error/i.test((r.error && (r.error.reason || r.error.message)) || '');
    check(!internal, `${m}({$op}) no 500 / clean handling (got ${code || 'ok'})`);
  }

  if (LOGIN_EMAIL && LOGIN_PASSWORD) {
    console.log('-- positive: seeded login succeeds --');
    const r = await c.login(LOGIN_EMAIL, LOGIN_PASSWORD);
    check(!r.error && r.result && r.result.id, `login(${LOGIN_EMAIL}) succeeds`);
  } else {
    console.log('-- SKIP positive login (set DDP_TEST_EMAIL / DDP_TEST_PASSWORD) --');
  }

  if (process.env.REGRESS_RATE_LIMIT === '1') {
    console.log('-- rate limit: rapid login is throttled (per-connection 5/10s) --');
    let throttled = false;
    for (let i = 0; i < 9; i++) {
      const r = await c.call('login', [{user: {email: 'rl@example.com'}, password: {digest: 'x'.repeat(64), algorithm: 'sha-256'}}]);
      if (isThrottled(r)) { throttled = true; break; }
    }
    check(throttled, 'login throttled after rapid attempts');
  } else {
    console.log('-- SKIP rate-limit probe (set REGRESS_RATE_LIMIT=1; trips per-IP 20/min) --');
  }

  console.log(`\nauth regression: ${pass} pass / ${fail} fail`);
  c.close();
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('error', e.message); process.exit(2); });
setTimeout(() => { console.error('timeout'); process.exit(3); }, 45000);
