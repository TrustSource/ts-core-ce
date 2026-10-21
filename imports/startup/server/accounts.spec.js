 

import './accounts';
import {Meteor} from 'meteor/meteor';
import {Accounts} from 'meteor/accounts-base';
import {Roles} from 'meteor/alanning:roles';
import {expect} from 'chai';
import sinon from 'sinon';
import bcrypt from 'bcrypt';
import LogEvents from '/imports/lib/collections/logevents';
// Loads the roles 4.0 backwards-compat shim so the server-side `Roles.userIsInRole`
// name that production calls resolves to `Roles.userIsInRoleAsync` (stubbed below).
import './roles-compat';

const EMAIL_DEVELOPER = 'developer@example.com'
const EMAIL_WILLY = 'willy@example.com'

describe('Accounts', function () {

  const testUser = {
    _id: '3anc4c6udmxKLa4jg',
    name: EMAIL_DEVELOPER,
    emails: [{address: EMAIL_DEVELOPER}],
    profile: {companyId: 'abc'},
    roles: [undefined]
  };

  beforeEach(function () {
    sinon.stub(Accounts, 'createUser');
    // sinon >= 5 removed the 3-arg stub(obj, 'meth', fn) form - use callsFake.
    sinon.stub(Meteor, 'user').callsFake(function () {
      return testUser;
    });
  });

  afterEach(function () {
    Accounts.createUser.restore();
    Meteor.user.restore();
  });

  describe('- anonymous user', function () {
    beforeEach(function () {
      Meteor.user.restore(); // reset default stub, create new one which simulates 'user not logged in'
      sinon.stub(Meteor, 'user').callsFake(function () {
      });
    });

    it('should not be able to send invitations', function (done) {
      Meteor.call('inviteUser', 'Willy Wichtig', EMAIL_WILLY, function (err, data) {
        expect(data).to.be.undefined;
        expect(err.error).to.be.equal(403);
        expect(err.reason).to.be.equal('Access Denied');
        done();
      });
      expect(Accounts.createUser.called).to.be.false;
    });
  });

  describe('- developer', function () {
    beforeEach(function () {
      testUser.roles[0] = 'developer';
    });

    it('should not be able to send invitations', function (done) {
      Meteor.call('inviteUser', 'Willy Developer', EMAIL_WILLY, function (err, data) {
        expect(data).to.be.undefined;
        expect(err.error).to.be.equal(403);
        expect(err.reason).to.be.equal('Access Denied');
        done();
      });
      expect(Accounts.createUser.called).to.be.false;
    });
  });

  describe('- manager user', function () {
    let user;
    const invitedId = 'iNvItEdUsER00001x';

    beforeEach(async function () {
      testUser.roles[0] = 'manager';

      // Real throwaway user doc. hwillson:stub-collections is a gutted no-op shell
      // in Meteor 3, so insert real data and clean it up. Insert via the raw
      // collection to bypass the strict UserSchema - the shared testUser fixture
      // uses non-schema values (companyId 'abc', roles as an array).
      await Meteor.users.removeAsync({_id: testUser._id});
      await Meteor.users.rawCollection().insertOne(testUser);
      user = await Meteor.users.findOneAsync(testUser._id);

      // inviteUser resolves the caller via Meteor.userAsync() and gates on
      // Roles.userIsInRole - simulate an authorized admin. Accounts.sendEnrollmentEmail
      // is async in Meteor 3; stub it so the enrollment path is deterministic
      // (no SMTP, no template render against absent inviter/company docs).
      sinon.stub(Meteor, 'userAsync').callsFake(async () => user);
      sinon.stub(Roles, 'userIsInRoleAsync').callsFake(async () => true);
      sinon.stub(Accounts, 'sendEnrollmentEmail').resolves();
    });

    afterEach(async function () {
      Meteor.userAsync.restore();
      Roles.userIsInRoleAsync.restore();
      Accounts.sendEnrollmentEmail.restore();
      await Meteor.users.removeAsync({_id: testUser._id});
      await Meteor.users.removeAsync({_id: invitedId});
    });

    it('should be able to send invitations', async function () {
      const data = await Meteor.callAsync('inviteUser', 'Willy Manager', EMAIL_WILLY);
      expect(data).to.exist;
      expect(Accounts.createUser.called).to.be.true;
    });

    it('should be able to resend invitation', async function () {
      this.timeout(5000); // to prevent unexpected errors
      let err;
      try {
        await Meteor.callAsync('resendEnrollmentEmail', EMAIL_DEVELOPER, user);
      } catch (e) {
        err = e;
      }
      expect(err).to.be.undefined;
    });

    it('should not be able to resend invitation with wrong email', async function () {
      let err;
      try {
        // No client `user` arg -> resolve strictly by email. An address with no
        // matching account must surface a controlled error, not silently succeed.
        // (When a `user` is supplied the hardened method re-resolves by its _id
        // and ignores the email, so it would send.)
        await Meteor.callAsync('resendEnrollmentEmail', 'normal2@example.com');
      } catch (e) {
        err = e;
      }
      expect(err).to.exist;
    });

    // Regression: invited users may only have profile.email and no emails[].
    // Accounts.sendEnrollmentEmail -> generateResetToken then throws
    // "No such email for user." (masked as 403). resendEnrollmentEmail must
    // populate emails[] from profile.email first, like resetUserPassword does.
    it('should resend invitation when user has only profile.email and no emails[]', async function () {
      this.timeout(5000);
      await Meteor.users.rawCollection().insertOne({
        _id: invitedId,
        profile: {companyId: 'abc', email: 'invited@example.com', invitedBy: testUser._id},
        roles: [undefined]
      });
      const invited = await Meteor.users.findOneAsync(invitedId);
      await Meteor.callAsync('resendEnrollmentEmail', 'invited@example.com', invited);
      const updated = await Meteor.users.findOneAsync(invitedId);
      expect(updated.emails).to.be.an('array');
      expect(updated.emails[0].address).to.equal('invited@example.com');
    });

    // Regression: Accounts.sendEnrollmentEmail is async in Meteor 3. If it is
    // not awaited the method returns success while the send fails (silent
    // failure + unhandled rejection). The failure must reach the caller.
    it('should propagate sendEnrollmentEmail failures to the caller', async function () {
      // Reconfigure the beforeEach stub to reject (re-stubbing would throw
      // "already wrapped").
      Accounts.sendEnrollmentEmail.rejects(new Meteor.Error(403, 'Something went wrong. Please check your credentials.'));
      let err;
      try {
        await Meteor.callAsync('resendEnrollmentEmail', EMAIL_DEVELOPER, user);
      } catch (e) {
        err = e;
      }
      expect(err).to.exist;
      expect(err.error).to.equal(403);
    });
  });

  // ------------------------------------------------------------------------
  // resetUserPassword / resendEnrollmentEmail: split-account selection + safe
  // backfill.
  //
  // A "split account" is the same address living on more than one doc: a
  // CANONICAL doc (address in emails[], usually with services.password) and a
  // STRAY doc (address only in profile.email/username, e.g. an invited user).
  // The old findOneAsync($or) could return the stray, then $set emails[] from
  // profile.email - colliding with the canonical's value on the unique
  // emails.address_1 index (E11000 -> unhandled 500). The fix must always
  // target the canonical owner and never write a colliding emails[] entry.
  //
  // HARNESS NOTE: the vendored Meteor-3 `hwillson:stub-collections` is an empty
  // shell (StubCollections.stub is undefined), so these tests cannot use it.
  // Instead Meteor.users.{find,findOneAsync,updateAsync} are stubbed with a
  // tiny in-memory matcher that understands ONLY the selectors these two
  // methods build ($or over emails.address/profile.email/username, _id, $ne,
  // and emails $elemMatch $regex). This exercises the real selection/backfill
  // logic without enforcing a unique index, so the collision branch (crit 2/9)
  // is exercised by making updateAsync reject with an E11000-shaped error.
  // ------------------------------------------------------------------------
  describe('- account email recovery (split account)', function () {
    const SPLIT_EMAIL = 'split.user@example.com';
    let docs;

    function matchEmailsAddress(doc, address) {
      return Array.isArray(doc.emails) && doc.emails.some(function (e) {
        return e && typeof e.address === 'string' && e.address === address;
      });
    }

    // Address held in emails[] under a case-insensitive anchored $regex.
    function matchEmailsRegex(doc, regex, options) {
      const re = new RegExp(regex, options && options.indexOf('i') !== -1 ? 'i' : '');
      return Array.isArray(doc.emails) && doc.emails.some(function (e) {
        return e && typeof e.address === 'string' && re.test(e.address);
      });
    }

    function matchProfileEmailRegex(doc, regex, options) {
      const re = new RegExp(regex, options && options.indexOf('i') !== -1 ? 'i' : '');
      return !!(doc.profile && typeof doc.profile.email === 'string' && re.test(doc.profile.email));
    }

    function matchesClause(doc, clause) {
      if (clause['emails.address'] !== undefined) {
        return matchEmailsAddress(doc, clause['emails.address']);
      }
      if (clause['profile.email'] !== undefined) {
        const v = clause['profile.email'];
        if (v && v.$regex) return matchProfileEmailRegex(doc, v.$regex, v.$options);
        return !!(doc.profile && doc.profile.email === v);
      }
      if (clause.username !== undefined) {
        return doc.username === clause.username;
      }
      if (clause.emails && clause.emails.$elemMatch) {
        const em = clause.emails.$elemMatch;
        const addr = em.address;
        if (addr && addr.$regex) return matchEmailsRegex(doc, addr.$regex, addr.$options);
        return matchEmailsAddress(doc, addr);
      }
      return false;
    }

    function matches(doc, selector) {
      if (typeof selector === 'string') return doc._id === selector;
      let ok = true;
      if (selector._id !== undefined) {
        if (selector._id && selector._id.$ne !== undefined) ok = ok && doc._id !== selector._id.$ne;
        else ok = ok && doc._id === selector._id;
      }
      if (selector.$or) {
        ok = ok && selector.$or.some(function (clause) { return matchesClause(doc, clause); });
      }
      // top-level non-$or clauses (e.g. {_id:{$ne}, 'emails.address': addr})
      const rest = Object.assign({}, selector);
      delete rest._id;
      delete rest.$or;
      Object.keys(rest).forEach(function (k) {
        ok = ok && matchesClause(doc, {[k]: rest[k]});
      });
      return ok;
    }

    function insert(doc) {
      const _id = doc._id || ('id-' + Math.random().toString(36).slice(2));
      docs.push(Object.assign({_id: _id}, doc));
      return _id;
    }

    beforeEach(function () {
      docs = [];
      sinon.stub(Meteor.users, 'find').callsFake(function (selector) {
        const matched = docs.filter(function (d) { return matches(d, selector || {}); });
        return {fetchAsync: function () { return Promise.resolve(matched.map(function (d) { return Object.assign({}, d); })); }};
      });
      sinon.stub(Meteor.users, 'findOneAsync').callsFake(function (selector) {
        const hit = docs.find(function (d) { return matches(d, selector || {}); });
        return Promise.resolve(hit ? Object.assign({}, hit) : undefined);
      });
      sinon.stub(Meteor.users, 'updateAsync').callsFake(function (id, mod) {
        const doc = docs.find(function (d) { return d._id === id; });
        if (doc && mod && mod.$set) Object.assign(doc, mod.$set);
        return Promise.resolve(1);
      });
    });

    afterEach(function () {
      Meteor.users.find.restore();
      Meteor.users.findOneAsync.restore();
      Meteor.users.updateAsync.restore();
      if (Accounts.sendResetPasswordEmail.restore) Accounts.sendResetPasswordEmail.restore();
      if (Accounts.sendEnrollmentEmail.restore) Accounts.sendEnrollmentEmail.restore();
    });

    function findDoc(id) { return docs.find(function (d) { return d._id === id; }); }

    // Canonical doc A: holds the address in emails[] and has a password service.
    function canonical(address, verified) {
      return {
        emails: [{address: address, verified: !!verified}],
        services: {password: {bcrypt: 'x'}},
        profile: {companyId: 'abc', email: address}
      };
    }

    describe('resetUserPassword', function () {
      beforeEach(function () {
        sinon.stub(Accounts, 'sendResetPasswordEmail').resolves();
      });

      // crit 1, 3 (A-then-B order)
      it('targets the canonical owner (A), not the stray (B) - A inserted first', function (done) {
        this.timeout(5000);
        const aId = insert(canonical(SPLIT_EMAIL, true));
        const bId = insert({profile: {companyId: 'abc', email: SPLIT_EMAIL}});
        Meteor.call('resetUserPassword', SPLIT_EMAIL, function (err) {
          expect(err).to.be.undefined;
          setTimeout(function () {
            expect(Accounts.sendResetPasswordEmail.calledOnce).to.be.true;
            expect(Accounts.sendResetPasswordEmail.firstCall.args[0]).to.equal(aId);
            const strayB = findDoc(bId);
            expect(strayB.emails === undefined || strayB.emails.length === 0).to.be.true;
            done();
          }, 200);
        });
      });

      // crit 1, 2, 3 (B-then-A order - any candidate ordering must still pick A)
      it('targets the canonical owner (A), not the stray (B) - B inserted first', function (done) {
        this.timeout(5000);
        const bId = insert({profile: {companyId: 'abc', email: SPLIT_EMAIL}});
        const aId = insert(canonical(SPLIT_EMAIL, true));
        Meteor.call('resetUserPassword', SPLIT_EMAIL, function (err) {
          expect(err).to.be.undefined;
          setTimeout(function () {
            expect(Accounts.sendResetPasswordEmail.calledOnce).to.be.true;
            expect(Accounts.sendResetPasswordEmail.firstCall.args[0]).to.equal(aId);
            const strayB = findDoc(bId);
            expect(strayB.emails === undefined || strayB.emails.length === 0).to.be.true;
            done();
          }, 200);
        });
      });

      // crit 4: single invited-only user (no other owner) is still backfilled + sent.
      it('backfills emails[] for a single invited-only user and sends', function (done) {
        this.timeout(5000);
        const invitedId = insert({profile: {companyId: 'abc', email: 'invited@example.com'}});
        Meteor.call('resetUserPassword', 'invited@example.com', function (err) {
          expect(err).to.be.undefined;
          setTimeout(function () {
            const updated = findDoc(invitedId);
            expect(updated.emails).to.be.an('array');
            expect(updated.emails[0].address).to.equal('invited@example.com');
            expect(updated.emails[0].verified).to.equal(false);
            expect(Accounts.sendResetPasswordEmail.calledOnce).to.be.true;
            expect(Accounts.sendResetPasswordEmail.firstCall.args[0]).to.equal(invitedId);
            done();
          }, 200);
        });
      });

      // crit 5: unknown address -> success-shaped, no send.
      it('returns success-shaped and does not send for an unknown address', function (done) {
        this.timeout(5000);
        Meteor.call('resetUserPassword', 'nobody@example.com', function (err) {
          expect(err).to.be.undefined;
          setTimeout(function () {
            expect(Accounts.sendResetPasswordEmail.called).to.be.false;
            done();
          }, 200);
        });
      });

      // crit 6: an address that lives ONLY in username (no emails[], no
      // profile.email) must degrade to success-shaped - NOT throw the old
      // 400 'User has no email address'. Otherwise that throw is an
      // enumeration oracle distinguishing this doc from unknown addresses.
      // Also asserts no colliding emails[] backfill is written.
      it('returns success-shaped for a username-only doc (no emails[], no profile.email)', function (done) {
        this.timeout(5000);
        const userId = insert({username: 'login-only@example.com', profile: {companyId: 'abc'}});
        Meteor.call('resetUserPassword', 'login-only@example.com', function (err) {
          expect(err).to.be.undefined;
          setTimeout(function () {
            const updated = findDoc(userId);
            expect(updated.emails === undefined || updated.emails.length === 0).to.be.true;
            done();
          }, 200);
        });
      });

      // crit 8: operator injection -> 400, no DB query at all.
      it('rejects a non-string email with 400 and does not query the DB', function (done) {
        Meteor.call('resetUserPassword', {$ne: null}, function (err) {
          expect(err).to.exist;
          expect(err.error).to.equal(400);
          expect(Meteor.users.find.called).to.be.false;
          expect(Meteor.users.findOneAsync.called).to.be.false;
          done();
        });
      });

      // crit 2, 6: E11000 on the backfill write is swallowed -> success-shaped
      // (indistinguishable from the unknown/invited paths, no new oracle).
      it('swallows an E11000 backfill collision and returns success-shaped', function (done) {
        this.timeout(5000);
        insert({profile: {companyId: 'abc', email: 'collide@example.com'}});
        Meteor.users.updateAsync.restore();
        sinon.stub(Meteor.users, 'updateAsync').rejects(Object.assign(new Error('E11000 duplicate key'), {code: 11000}));
        Meteor.call('resetUserPassword', 'collide@example.com', function (err) {
          expect(err).to.be.undefined;
          done();
        });
      });

      // crit 6 (explicit no-oracle): the unknown, success, and E11000-collision
      // paths must return the IDENTICAL shape so the response cannot be used to
      // tell them apart. Drive all three through the same method and compare the
      // resolved error/result side by side.
      it('returns an indistinguishable shape for unknown, success, and collision paths', function (done) {
        this.timeout(5000);
        // success path: a real canonical owner exists.
        insert(canonical('exists@example.com', true));
        // collision path: stray whose backfill write rejects with E11000.
        insert({profile: {companyId: 'abc', email: 'collide3@example.com'}});
        Meteor.users.updateAsync.restore();
        sinon.stub(Meteor.users, 'updateAsync').rejects(Object.assign(new Error('E11000 duplicate key'), {code: 11000}));

        const call = function (addr) {
          return new Promise(function (resolve) {
            Meteor.call('resetUserPassword', addr, function (err, res) {
              resolve({err: err, res: res});
            });
          });
        };

        Promise.all([
          call('nobody-here@example.com'), // unknown
          call('exists@example.com'),      // success
          call('collide3@example.com')     // collision (E11000 swallowed)
        ]).then(function (outcomes) {
          const unknown = outcomes[0], success = outcomes[1], collision = outcomes[2];
          // No error escapes on any path.
          expect(unknown.err).to.be.undefined;
          expect(success.err).to.be.undefined;
          expect(collision.err).to.be.undefined;
          // No distinguishing result value either.
          expect(unknown.res).to.deep.equal(success.res);
          expect(collision.res).to.deep.equal(success.res);
          done();
        });
      });
    });

    describe('resendEnrollmentEmail', function () {
      beforeEach(function () {
        sinon.stub(Accounts, 'sendEnrollmentEmail').resolves();
      });

      // crit 9: split -> no collision write, send goes to the canonical owner A.
      it('targets the canonical owner (A), not the stray (B)', function (done) {
        this.timeout(5000);
        const bId = insert({profile: {companyId: 'abc', email: SPLIT_EMAIL}});
        const aId = insert(canonical(SPLIT_EMAIL, false));
        // No client `user` arg -> resolve by email; must pick A even with B first.
        Meteor.call('resendEnrollmentEmail', SPLIT_EMAIL, undefined, function (err) {
          expect(err).to.be.undefined;
          expect(Accounts.sendEnrollmentEmail.calledOnce).to.be.true;
          expect(Accounts.sendEnrollmentEmail.firstCall.args[0]).to.equal(aId);
          const strayB = findDoc(bId);
          expect(strayB.emails === undefined || strayB.emails.length === 0).to.be.true;
          done();
        });
      });

      // crit 9: an E11000 on the backfill write surfaces as a CONTROLLED
      // Meteor.Error, never a raw Mongo error / 500.
      it('contains an E11000 backfill collision as a controlled Meteor.Error', function (done) {
        this.timeout(5000);
        insert({profile: {companyId: 'abc', email: 'collide2@example.com'}});
        Meteor.users.updateAsync.restore();
        sinon.stub(Meteor.users, 'updateAsync').rejects(Object.assign(new Error('E11000 duplicate key'), {code: 11000}));
        Meteor.call('resendEnrollmentEmail', 'collide2@example.com', undefined, function (err) {
          expect(err).to.exist;
          expect(err).to.be.an.instanceof(Meteor.Error);
          // Must be the controlled application error, not a raw Mongo 500.
          expect(err.error).to.equal('User not found');
          expect(err.errorType).to.equal('Meteor.Error');
          expect(String(err.message)).to.not.match(/E11000/);
          done();
        });
      });
    });
  });

  describe('verifyUserPassword', function () {
    // Regression test: line 761 called the synchronous Accounts._checkPassword,
    // which accounts-password no longer exposes (only _checkPasswordAsync
    // exists) - every real verification attempt threw
    // "Accounts._checkPassword is not a function". Pre-existing bug, unrelated
    // to any particular Meteor version bump.
    const TOKEN = 'verify-token-regression-001';
    const DIGEST = 'known-test-digest-value';
    const VERIFY_USER_ID = 'vErIfYrEgReSs0001';

    beforeEach(async function () {
      const hash = await bcrypt.hash(DIGEST, 10);
      await Meteor.users.removeAsync({_id: VERIFY_USER_ID});
      await Meteor.users.rawCollection().insertOne({
        _id: VERIFY_USER_ID,
        profile: {},
        emails: [{address: 'verify-regress@example.com'}],
        services: {
          password: {bcrypt: hash},
          email: {verificationTokens: [{token: TOKEN}]}
        }
      });
    });

    afterEach(async function () {
      await Meteor.users.removeAsync({_id: VERIFY_USER_ID});
      await LogEvents.removeAsync({userId: VERIFY_USER_ID});
    });

    it('verifies a correct password digest and returns true', async function () {
      const result = await Meteor.callAsync('verifyUserPassword', TOKEN, DIGEST);
      expect(result).to.be.true;
    });

    it('rejects an incorrect password digest and returns false', async function () {
      const result = await Meteor.callAsync('verifyUserPassword', TOKEN, 'wrong-digest-value');
      expect(result).to.be.false;
    });
  });

});
