import {Meteor} from 'meteor/meteor';
import {Config} from '/imports/server/config';
import {accountStatusOf, ACCOUNT_STATUS, ACCOUNT_STATUS_FIELD} from '/imports/lib/accountStatus';

// --------------------------------------------------------------------------
// Central DDP authentication + account-status guard.
//
// Historically every Meteor method was reachable over the raw DDP WebSocket
// (wss://.../websocket) without any authentication, because individual methods
// did not check `this.userId`. This wraps every registered method handler so
// that a call arriving over a *client* DDP connection must be authenticated.
//
// Only the TOP-LEVEL call in a chain is gated:
//   - real client DDP call  -> `this.connection` is the connection object;
//     an unauthenticated one (no `this.userId`) is rejected unless allowlisted.
//   - server-to-server call  -> `this.connection` is null (trusted internal
//     `Meteor.call*`, e.g. from interactors or the REST API layer).
//
// Nested method calls (a method invoking another via `Meteor.call*`) are NOT
// re-gated: they can only be reached *through* an already-gated top-level call.
// This is required because some allowlisted public methods legitimately fan out
// to non-public methods while still unauthenticated - e.g. `login` triggers
// `Accounts.validateLoginAttempt`, which calls `LoginsHistory.Create`. Gating
// only the entry point keeps those internal flows working without having to
// enumerate every method the login / 2FA / SSO / onLogin paths touch.
//
// LIVE-SESSION SUSPENSION: a suspicious/suspended user must lose
// platform access even while a session is live. Enforcement is PULL-BASED (no
// oplog/change-stream instant kill): an authenticated top-level method call and
// every publication re-check the caller's `accountStatus` (short-TTL cached).
// `accountStatus` is never written by this guard - only the external admin app
// writes it, in another process.
// --------------------------------------------------------------------------

// Set for the duration of a gated call chain; nested calls observe it (Meteor
// environment variables propagate across nested `Meteor.call*`) and skip the check.
const pastGate = new Meteor.EnvironmentVariable();

// Methods that must remain callable by unauthenticated DDP clients:
// login / account recovery / pre-login flows. Everything else requires auth.
// A suspended user is still allowed these (so they can `logout`/`getNewToken`
// and pre-login flows are never bricked).
const PUBLIC_METHODS = new Set([
  // accounts-base / accounts-password built-ins (login itself runs unauthenticated)
  'login',
  'logout',
  'logoutOtherClients',
  'getNewToken',
  'removeOtherTokens',
  // NOTE: the built-in `forgotPassword` is intentionally NOT allowlisted - the
  // app's password-reset request goes through `resetUserPassword` (below), and
  // the built-in's "User not found" error is an account-enumeration oracle.
  // Leaving it guarded means an unauthenticated probe gets 401, not an oracle.
  'resetPassword',
  'verifyEmail',
  'createUser',
  // No method of this name is implemented or called in ts-app today (kept for
  // accounts-package compatibility). If one is ever added it MUST check
  // accountStatusOf(user) === 'active' first - otherwise an account suspended
  // before verifying its e-mail could self-serve the link.
  'resendVerificationEmail',
  // app pre-login flows - each is token/email guarded internally
  'getUserInfoByToken',
  'resetPasswordByToken',
  'resetUserPassword',
  'verifyUserPassword',
  // low-risk client logging invoked from pre-login (login/register) pages
  'logEvent'
]);

// Methods only server code may call. A client calling one directly is refused;
// server code calling it - a REST route, an interactor, or a call nested inside
// a method a client did call (pastGate is set there, although the nested call
// inherits the client's connection) - runs as before.
const INTERNAL_METHODS = new Set([
  // Writes the platform-wide component history with the author the caller names
  // and trims it to the newest 10 entries, so ten client calls could erase a
  // component's real history. Only server code writes it.
  'ComponentLogs.Create',
  // Public release feeds (REST routes under /api/v2/compliance/releases and the
  // CSAF feed). They resolve a key or release id without checking the caller's
  // company, so a client could fetch another company's SBOM, Notice or VEX, or
  // grow a company's request log. The UI uses the *.preview methods instead.
  'publicBoMKey.one',
  'publicBoMKey.getFile',
  'publicBoMKey.saveRequest',
  'publicNoticeKey.one',
  'publicNoticeKey.getFile',
  'publicNoticeKey.saveRequest',
  'publicReleaseKey.one',
  'publicReleaseKey.saveRequest',
  'publicVexKey.getFile',
  'publicCsafKey.findByKey',
  'publicCsafKey.saveRequest',
  // Signature store: a client insert would make forged content "found in server".
  'Signatures.create',
  'Signatures.count',
  'Signatures.findOne',
  // Approval side effects, called only from Approves.Approve / Approves.Reject
  // (UI and REST). They took the company from a user object in their arguments,
  // so a client could mark another company's release released, publish its
  // release key and fire its webhooks, or notify its managers.
  'Approves.MarkDocumentsAsReleased',
  'notifyAboutApprovedOrRejected'
]);

// Short-TTL memoization of the per-user active check, keyed by userId. Keeps a
// live session's method/publish traffic from hammering the DB while still
// reflecting a suspension within a few seconds.
const ACCOUNT_ACTIVE_TTL_MS = 10 * 1000;
const accountActiveCache = new Map();

// Exposed for tests: reset the memoization between cases.
export function _clearAccountActiveCache() {
  accountActiveCache.clear();
}

/**
 * Is this user currently allowed on the platform? A direct (non-nested) DB read
 * of `accountStatus`, memoized for ACCOUNT_ACTIVE_TTL_MS. A missing/unknown
 * status resolves to active (never lock a legitimate user out on a lookup miss).
 */
export async function isAccountActive(userId) {
  const now = Date.now();
  const cached = accountActiveCache.get(userId);
  if (cached && (now - cached.at) < ACCOUNT_ACTIVE_TTL_MS) {
    return cached.value;
  }
  // Direct collection read (not a nested Meteor.call) so it does not interact
  // with the pastGate call-chain gating above.
  const user = await Meteor.users.findOneAsync(userId, {fields: {[ACCOUNT_STATUS_FIELD]: 1}});
  const active = accountStatusOf(user) === ACCOUNT_STATUS.ACTIVE;
  accountActiveCache.set(userId, {value: active, at: now});
  return active;
}

/**
 * Wrap a method handler with the DDP auth gate + account-status suspension gate.
 * Exported so the wrapping logic is unit-testable in isolation.
 */
export function guardMethodHandler(name, original) {
  const guarded = async function (...args) {
    // Nested call inside an already-gated chain - trusted, run as-is.
    if (pastGate.get()) {
      return original.apply(this, args);
    }
    if (this.connection && !this.userId && !PUBLIC_METHODS.has(name)) {
      throw new Meteor.Error(401, 'Authentication required');
    }
    if (this.connection && INTERNAL_METHODS.has(name)) {
      throw new Meteor.Error(403, 'Access Denied');
    }
    // Live-session suspension: an authenticated client call from a
    // suspicious/suspended user is refused (public methods stay reachable).
    if (this.connection && this.userId && !PUBLIC_METHODS.has(name)
        && !(await isAccountActive(this.userId))) {
      throw new Meteor.Error(403, 'Account suspended');
    }
    return pastGate.withValue(true, () => original.apply(this, args));
  };
  guarded.__authGuarded = true;
  return guarded;
}

/**
 * Wrap a publish handler so a suspicious/suspended subscriber receives an empty
 * (ready) subscription instead of any data. Unauthenticated subscribers are left
 * to the publication's own guards. Exported for unit testing.
 */
export function guardPublishHandler(original) {
  const guarded = async function (...args) {
    if (this.userId && !(await isAccountActive(this.userId))) {
      this.ready();
      return;
    }
    return original.apply(this, args);
  };
  guarded.__accountStatusGuarded = true;
  return guarded;
}

Meteor.startup(function () {
  const handlers = Meteor.server && Meteor.server.method_handlers;
  if (!handlers) {
    console.error('[security-guard] Meteor.server.method_handlers unavailable; DDP auth guard NOT installed');
    return;
  }

  let wrapped = 0;
  Object.keys(handlers).forEach(function (name) {
    const original = handlers[name];
    if (typeof original !== 'function' || original.__authGuarded) {
      return;
    }
    handlers[name] = guardMethodHandler(name, original);
    wrapped += 1;
  });

  if (Config.DEBUG_MODE_ENABLED) {
    console.log(`=> DDP auth guard installed on ${wrapped} methods `
      + `(${PUBLIC_METHODS.size} public methods allowlisted)`);
  }

  // Live-session suspension guard on every named publication.
  const publishHandlers = Meteor.server.publish_handlers;
  if (publishHandlers) {
    let wrappedPublish = 0;
    Object.keys(publishHandlers).forEach(function (name) {
      const original = publishHandlers[name];
      if (typeof original !== 'function' || original.__accountStatusGuarded) {
        return;
      }
      publishHandlers[name] = guardPublishHandler(original);
      wrappedPublish += 1;
    });
    if (Config.DEBUG_MODE_ENABLED) {
      console.log(`=> account-status publish guard installed on ${wrappedPublish} publications`);
    }
  }
});
