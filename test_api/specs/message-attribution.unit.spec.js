/* eslint-disable no-undef */
// Pure-logic unit spec for the Messages.Create client/server attribution helper
// (DDP hardening). The helper decides, based on the invocation context,
// whether a call is a trusted server-to-server delivery (notify* helpers,
// sendMessageToFollowers) or a hostile DDP client that may only self-attribute a
// public message in its own company.
//
// Mirrors safe-user-fields.spec.js: a pure CommonJS module with no Meteor import,
// so the jest harness can exercise the branch logic without a running server.
const {
  resolveMessageAttribution,
  isServerInternal
} = require('../../imports/server/security/messageAttribution');

// A server-internal invocation has no `connection` (collection hooks, interactors,
// Meteor.callAsync from server code). A DDP client invocation carries a non-null
// `connection` and the authenticated `userId`.
const serverInvocation = { connection: null, userId: null };
const clientInvocation = (userId) => ({ connection: { id: 'sockjs-1' }, userId });

describe('resolveMessageAttribution (#83)', () => {
  // The single highest-regression case: a wrong client-vs-server branch would
  // silently rewrite the attribution of every notify*/sendMessageToFollowers
  // delivery. Assert the GREEN server-to-server path FIRST.
  describe('server-internal (trusted) path', () => {
    it('passes server-supplied userId/senderId/recipient through unchanged', () => {
      const fields = { userId: 'recipientU', senderId: 'serverSenderU' };
      const out = resolveMessageAttribution(serverInvocation, fields);
      expect(out.userId).toBe('recipientU');
      expect(out.senderId).toBe('serverSenderU');
    });

    it('treats a missing/undefined invocation as server-internal (defensive)', () => {
      const fields = { userId: 'recipientU', senderId: 'serverSenderU' };
      expect(resolveMessageAttribution(undefined, fields).senderId).toBe('serverSenderU');
      expect(resolveMessageAttribution(null, fields).senderId).toBe('serverSenderU');
    });

    it('treats an invocation with no connection but a userId as server-internal', () => {
      // Some server contexts expose this.userId yet no DDP connection - still trusted.
      const out = resolveMessageAttribution({ connection: null, userId: 'x' },
        { userId: 'recipientU', senderId: 'serverSenderU' });
      expect(out.userId).toBe('recipientU');
      expect(out.senderId).toBe('serverSenderU');
    });

    it('does not force public/scope on the server path', () => {
      const out = resolveMessageAttribution(serverInvocation,
        { userId: 'recipientU', senderId: 'serverSenderU' });
      // Server callers fully control attribution; the helper must not rewrite it.
      expect(out.forceCallerScope).toBe(false);
    });
  });

  describe('client (hostile) path', () => {
    it('throws when the DDP caller is not authenticated', () => {
      expect(() => resolveMessageAttribution(clientInvocation(null), { senderId: 'whatever' }))
        .toThrow();
    });

    it('forces senderId to the authenticated caller, ignoring a spoofed senderId', () => {
      const out = resolveMessageAttribution(clientInvocation('callerU'),
        { senderId: 'victimU', message: 'hi' });
      expect(out.senderId).toBe('callerU');
      expect(out.forceCallerScope).toBe(true);
    });

    it('strips a client-supplied userId (no cross-tenant recipient targeting)', () => {
      const out = resolveMessageAttribution(clientInvocation('callerU'),
        { userId: 'foreignRecipientU', senderId: 'callerU' });
      expect(out.userId).toBeUndefined();
    });

    it('forces senderId to the caller even when the client omits it', () => {
      const out = resolveMessageAttribution(clientInvocation('callerU'),
        { projectId: 'p', message: 'hi' });
      expect(out.senderId).toBe('callerU');
    });

    it('does not leak any other client field as attribution', () => {
      const out = resolveMessageAttribution(clientInvocation('callerU'),
        { senderId: 'victimU', userId: 'victimRecipient', senderName: 'Spoofed Name' });
      expect(out.senderId).toBe('callerU');
      expect(out.userId).toBeUndefined();
    });

    it('throws for a DDP caller whose userId is an empty string (falsy, unauthenticated)', () => {
      // A connection-bearing invocation with no real userId must be denied - an
      // empty string would otherwise be pinned as the (forged) sender.
      expect(() => resolveMessageAttribution(clientInvocation(''), { senderId: 'x' }))
        .toThrow();
    });

    it('throws a Meteor.Error-shaped value ({error:403}) the interactor can rethrow', () => {
      try {
        resolveMessageAttribution(clientInvocation(null), { senderId: 'x' });
        throw new Error('expected resolveMessageAttribution to throw');
      } catch (e) {
        expect(e.error).toBe(403);
        expect(e.reason).toBe('Access Denied');
      }
    });
  });

  // The exported predicate the helper branches on. Asserting it directly pins the
  // server-vs-client contract independently of resolveMessageAttribution, so a
  // future refactor of the wrapper cannot quietly invert the branch.
  describe('isServerInternal predicate', () => {
    it('treats undefined / null invocation as server-internal', () => {
      expect(isServerInternal(undefined)).toBe(true);
      expect(isServerInternal(null)).toBe(true);
    });

    it('treats a null/absent connection as server-internal even with a userId', () => {
      expect(isServerInternal({ connection: null, userId: 'x' })).toBe(true);
      expect(isServerInternal({ userId: 'x' })).toBe(true);
    });

    it('treats any non-null connection as a DDP client (NOT server-internal)', () => {
      expect(isServerInternal({ connection: { id: 'sockjs-1' }, userId: 'u' })).toBe(false);
      // A connection object is enough - even an unauthenticated one is a client.
      expect(isServerInternal({ connection: { id: 'sockjs-2' }, userId: null })).toBe(false);
    });
  });
});
