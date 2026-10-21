import {
  isAccountActive,
  _clearAccountActiveCache,
  guardMethodHandler,
  guardPublishHandler
} from './security-guard';
import {Meteor} from 'meteor/meteor';
import {expect} from 'chai';
import sinon from 'sinon';

// Live-session suspension guards: pull-based method + publish guards
// that deny access to a suspicious/suspended user without an instant session-kill.
describe('security-guard account-status (#95)', function () {

  afterEach(function () {
    if (Meteor.users.findOneAsync.restore) {
      Meteor.users.findOneAsync.restore();
    }
    _clearAccountActiveCache();
  });

  function stubStatus(status) {
    sinon.stub(Meteor.users, 'findOneAsync').callsFake(function () {
      return Promise.resolve(status === undefined ? {} : {accountStatus: status});
    });
  }

  describe('isAccountActive', function () {
    beforeEach(function () {
      _clearAccountActiveCache();
    });

    it('is false for a suspended user', async function () {
      stubStatus('suspended');
      expect(await isAccountActive('u-suspended')).to.be.false;
    });

    it('is false for a suspicious user', async function () {
      stubStatus('suspicious');
      expect(await isAccountActive('u-suspicious')).to.be.false;
    });

    it('is true for an active user', async function () {
      stubStatus('active');
      expect(await isAccountActive('u-active')).to.be.true;
    });

    it('is true when the field is absent', async function () {
      stubStatus(undefined);
      expect(await isAccountActive('u-absent')).to.be.true;
    });

    it('memoizes within the TTL (single DB read for repeated lookups)', async function () {
      stubStatus('active');
      await isAccountActive('u-cache');
      await isAccountActive('u-cache');
      expect(Meteor.users.findOneAsync.calledOnce).to.be.true;
    });

    it('re-reads after the cache is cleared', async function () {
      stubStatus('active');
      await isAccountActive('u-cache2');
      _clearAccountActiveCache();
      await isAccountActive('u-cache2');
      expect(Meteor.users.findOneAsync.calledTwice).to.be.true;
    });
  });

  describe('guardMethodHandler', function () {
    it('throws 403 for a suspended caller and does not run the method body', async function () {
      stubStatus('suspended');
      const body = sinon.spy(function () { return 'BODY'; });
      const guarded = guardMethodHandler('getUserCompanies', body);
      let err;
      try {
        await guarded.call({connection: {}, userId: 'susp'});
      } catch (e) {
        err = e;
      }
      expect(err).to.exist;
      expect(err.error).to.equal(403);
      expect(body.called).to.be.false;
    });

    it('runs the method body for an active caller', async function () {
      stubStatus('active');
      const guarded = guardMethodHandler('getUserCompanies', function () { return 'BODY'; });
      const result = await guarded.call({connection: {}, userId: 'act'});
      expect(result).to.equal('BODY');
    });

    it('allows a public method (logout) even for a suspended caller', async function () {
      stubStatus('suspended');
      const guarded = guardMethodHandler('logout', function () { return 'BODY'; });
      const result = await guarded.call({connection: {}, userId: 'susp'});
      expect(result).to.equal('BODY');
    });

    it('still rejects an unauthenticated caller with 401', async function () {
      const guarded = guardMethodHandler('getUserCompanies', function () { return 'BODY'; });
      let err;
      try {
        await guarded.call({connection: {}, userId: null});
      } catch (e) {
        err = e;
      }
      expect(err).to.exist;
      expect(err.error).to.equal(401);
    });

    it('does not block trusted server-side calls (no connection)', async function () {
      stubStatus('suspended');
      const guarded = guardMethodHandler('getUserCompanies', function () { return 'BODY'; });
      const result = await guarded.call({connection: null, userId: 'susp'});
      expect(result).to.equal('BODY');
    });
  });

  describe('guardPublishHandler', function () {
    it('calls this.ready() and does not delegate for a suspended subscriber', async function () {
      stubStatus('suspended');
      const original = sinon.spy(function () { return 'CURSOR'; });
      const guarded = guardPublishHandler(original);
      const ready = sinon.spy();
      const result = await guarded.call({userId: 'susp', ready: ready});
      expect(ready.calledOnce).to.be.true;
      expect(original.called).to.be.false;
      expect(result).to.be.undefined;
    });

    it('delegates for an active subscriber', async function () {
      stubStatus('active');
      const original = sinon.spy(function () { return 'CURSOR'; });
      const guarded = guardPublishHandler(original);
      const ready = sinon.spy();
      const result = await guarded.call({userId: 'act', ready: ready});
      expect(original.calledOnce).to.be.true;
      expect(ready.called).to.be.false;
      expect(result).to.equal('CURSOR');
    });

    it('delegates for an unauthenticated subscriber', async function () {
      const original = sinon.spy(function () { return 'CURSOR'; });
      const guarded = guardPublishHandler(original);
      const ready = sinon.spy();
      const result = await guarded.call({userId: null, ready: ready});
      expect(original.calledOnce).to.be.true;
      expect(result).to.equal('CURSOR');
    });
  });
});
