// Client/server attribution decision for the Messages.Create method.
//
// Messages.Create is both a DDP-callable method (the module-dependencies UI
// posts component-comment / status-change messages) AND the delivery primitive
// every server-internal notify* helper + sendMessageToFollowers uses to drop an
// inbox message for an arbitrary recipient in an arbitrary company.
//
// The two callers must be distinguished by `this.connection`, NEVER by "is there
// a current user" - a hostile DDP client is always authenticated by the central
// auth guard, so presence of a user proves nothing.
//
//   • server-internal (no connection / no invocation): TRUSTED - pass the caller's
//     `userId` (recipient) and `senderId` straight through. Server code is
//     responsible for its own (correct, server-derived) attribution.
//   • DDP client (has connection): HOSTILE - require an authenticated caller,
//     FORCE senderId to `this.userId` (anti-spoof), and STRIP any client-supplied
//     `userId` recipient (a client may only create a public, self-attributed
//     message scoped to its own company; it must not address another user/tenant).
//
// CommonJS + no Meteor import so the pure decision can be unit-tested by the jest
// harness while remaining importable from Meteor ESM code. The thrown value is a
// plain object shaped like a Meteor.Error ({error, reason}) so the interactor can
// rethrow it as a real Meteor.Error without this module depending on Meteor.

function isServerInternal(invocation) {
  // Tolerate `this === undefined` defensively (treat as server-internal); a real
  // DDP client invocation always carries a non-null `connection`.
  return !invocation || !invocation.connection;
}

// Returns {userId, senderId, forceCallerScope}:
//   userId           - the recipient to write (undefined => public message)
//   senderId         - the sender to attribute
//   forceCallerScope - true when the interactor must additionally pin companyId
//                      to the caller (client path) for defense-in-depth.
function resolveMessageAttribution(invocation, fields) {
  const f = fields || {};
  if (isServerInternal(invocation)) {
    return {
      userId: f.userId,
      senderId: f.senderId,
      forceCallerScope: false
    };
  }
  // DDP client path - caller must be authenticated (the central guard already
  // enforces this for non-allowlisted methods, but re-check here defensively).
  if (!invocation.userId) {
    throw { error: 403, reason: 'Access Denied' };
  }
  return {
    // A client may only post a public, self-attributed message - never target a
    // specific (possibly foreign) recipient.
    userId: undefined,
    // Anti-spoof: ignore any client senderId, pin to the authenticated caller.
    senderId: invocation.userId,
    forceCallerScope: true
  };
}

module.exports = {
  isServerInternal,
  resolveMessageAttribution
};
