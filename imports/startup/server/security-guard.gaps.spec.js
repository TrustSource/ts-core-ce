import {
  isAccountActive,
  _clearAccountActiveCache,
  guardMethodHandler,
  guardPublishHandler
} from './security-guard';
import {Meteor} from 'meteor/meteor';
import {expect} from 'chai';
import sinon from 'sinon';

// Gap coverage for the live-session suspension guards.
//
// security-guard.spec.js already covers isAccountActive for suspended/suspicious/
// active/absent, back-to-back memoization, cache-clear re-read, the method guard's
// 403/401/public-method/server-side paths, and the publish guard's suspended/
// active/unauthenticated paths. These add the cases NOT covered there:
//   - genuine TTL EXPIRY (via fake clock) rather than a manual cache clear.
//   - FAIL-CLOSED behavior when the status lookup itself throws (DB error).
//   - a nested (already-gated) call is NOT re-gated (pastGate bypass).
//   - an unauthenticated caller of a PUBLIC method is allowed through.
describe('security-guard account-status gaps (#95)', function () {

  afterEach(function () {
    if (Meteor.users.findOneAsync.restore) {
      Meteor.users.findOneAsync.restore();
    }
    _clearAccountActiveCache();
  });

  describe('isAccountActive TTL expiry', function () {
    it('re-reads the DB only after the 10s TTL elapses', async function () {
      const clock = sinon.useFakeTimers();
      try {
        sinon.stub(Meteor.users, 'findOneAsync').callsFake(function () {
          return Promise.resolve({accountStatus: 'active'});
        });
        _clearAccountActiveCache();

        await isAccountActive('u-ttl');
        expect(Meteor.users.findOneAsync.calledOnce, 'first lookup hits DB').to.be.true;

        clock.tick(5000);
        await isAccountActive('u-ttl');
        expect(Meteor.users.findOneAsync.calledOnce, 'within TTL: still cached').to.be.true;

        clock.tick(5001); // total 10001ms > 10000ms TTL
        await isAccountActive('u-ttl');
        expect(Meteor.users.findOneAsync.calledTwice, 'after TTL: re-reads DB').to.be.true;
      } finally {
        clock.restore();
      }
    });
  });

  describe('fails CLOSED when the status lookup throws', function () {
    function stubThrow() {
      sinon.stub(Meteor.users, 'findOneAsync').callsFake(function () {
        return Promise.reject(new Error('DB unavailable'));
      });
    }

    it('method guard: rejects and does NOT run the method body on a lookup error', async function () {
      stubThrow();
      const body = sinon.spy(function () { return 'BODY'; });
      const guarded = guardMethodHandler('getUserCompanies', body);
      let err;
      try {
        await guarded.call({connection: {}, userId: 'x'});
      } catch (e) {
        err = e;
      }
      expect(err, 'a lookup error must surface, not be swallowed').to.exist;
      expect(body.called, 'method body must NOT execute on a lookup error').to.be.false;
    });

    it('publish guard: rejects and does NOT delegate to the publication on a lookup error', async function () {
      stubThrow();
      const original = sinon.spy(function () { return 'CURSOR'; });
      const guarded = guardPublishHandler(original);
      const ready = sinon.spy();
      let err;
      try {
        await guarded.call({userId: 'x', ready: ready});
      } catch (e) {
        err = e;
      }
      expect(err, 'a lookup error must surface, not be swallowed').to.exist;
      expect(original.called, 'publication must NOT run on a lookup error').to.be.false;
    });
  });

  describe('nested-call gating', function () {
    it('does not re-gate a nested call made inside an already-gated chain', async function () {
      // Active outer caller passes the gate; the nested call uses an
      // UNAUTHENTICATED context that would be 401 if it were re-gated.
      sinon.stub(Meteor.users, 'findOneAsync').callsFake(function () {
        return Promise.resolve({accountStatus: 'active'});
      });
      const innerBody = sinon.spy(function () { return 'INNER'; });
      const innerGuarded = guardMethodHandler('getUserCompanies', innerBody);
      const outerGuarded = guardMethodHandler('getUsers', async function () {
        return innerGuarded.call({connection: {}, userId: null});
      });

      const result = await outerGuarded.call({connection: {}, userId: 'act'});
      expect(innerBody.calledOnce, 'nested body runs without re-gating').to.be.true;
      expect(result).to.equal('INNER');
    });
  });

  describe('unauthenticated public method', function () {
    it('allows an unauthenticated caller of a PUBLIC method', async function () {
      // No DB lookup should be needed (public methods skip the suspension check).
      const body = sinon.spy(function () { return 'PUBLIC'; });
      const guarded = guardMethodHandler('login', body);
      const result = await guarded.call({connection: {}, userId: null});
      expect(result).to.equal('PUBLIC');
      expect(body.calledOnce).to.be.true;
    });
  });

  // Integration seam: the isolated wrapper tests above never verify that the
  // Meteor.startup hook actually INSTALLS the guards on the live registries.
  // Assert the wiring on real, app-registered handlers.
  describe('startup wiring installs the guards on real handlers', function () {
    it('wraps a registered (non-public) method handler with the auth guard', function () {
      const handler = Meteor.server.method_handlers['getUserCompanies'];
      expect(handler, 'getUserCompanies must be registered in the test bundle').to.be.a('function');
      expect(handler.__authGuarded).to.be.true;
    });

    it('wraps a public method handler too (it bypasses internally, not by staying unwrapped)', function () {
      const handler = Meteor.server.method_handlers['logout'];
      expect(handler, 'logout must be registered').to.be.a('function');
      expect(handler.__authGuarded).to.be.true;
    });

    it('wraps a registered publication with the account-status guard', function () {
      const handler = Meteor.server.publish_handlers['companyUsers'];
      expect(handler, 'companyUsers publication must be registered').to.be.a('function');
      expect(handler.__accountStatusGuarded).to.be.true;
    });
  });
});
