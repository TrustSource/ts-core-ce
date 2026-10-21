import './users';
import {Meteor} from 'meteor/meteor';
import {expect} from 'chai';

// Server-side write-lock for the read-only account-status fields.
//
// The authoritative barrier is a wrapper around Meteor.users.updateAsync (see
// users.js). It fires for any server-method / REST write and at any depth,
// including dotted sub-paths of the blackbox sub-docs that the schema `custom`
// cannot see, and throws a clean 403 before collection2 runs. upsertAsync is
// covered transitively. INSERT is intentionally NOT locked (no client-reachable
// insert path accepts these fields). Only ts-app-originating Mongo.Collection
// mutators are covered - external raw-Mongo writes are not (by design). These
// tests exercise the real Meteor.users collection against a throwaway inserted
// user.
describe('collections: users account-status write-lock (#95)', function () {

  let userId;

  beforeEach(async function () {
    // A valid user doc: profile.companyId must match SimpleSchema.RegEx.Id.
    userId = await Meteor.users.insertAsync({
      createdAt: new Date(),
      emails: [{address: 'lock-test-95@example.com', verified: true}],
      profile: {
        companyId: 'bwat59Bn6cneY7SRi',
        name: 'Lock Test',
        email: 'lock-test-95@example.com'
      }
    });
  });

  afterEach(async function () {
    if (userId) {
      await Meteor.users.removeAsync(userId);
      userId = undefined;
    }
  });

  async function reload() {
    return Meteor.users.findOneAsync(userId, {
      fields: {accountStatus: 1, accountStatusInfo: 1, accountClearing: 1, intro: 1}
    });
  }

  async function expectRejected403(promiseFactory) {
    let err;
    try {
      await promiseFactory();
    } catch (e) {
      err = e;
    }
    expect(err, 'expected the write to be rejected').to.exist;
    expect(err.error).to.equal(403);
  }

  it('rejects a top-level $set of accountStatus with 403 and does not persist it', async function () {
    await expectRejected403(() => Meteor.users.updateAsync(userId, {$set: {accountStatus: 'suspended'}}));
    expect((await reload()).accountStatus).to.be.undefined;
  });

  it('rejects a $set of accountStatusInfo with 403 and does not persist it', async function () {
    await expectRejected403(() => Meteor.users.updateAsync(userId, {$set: {accountStatusInfo: {reason: 'x'}}}));
    expect((await reload()).accountStatusInfo).to.be.undefined;
  });

  it('rejects a top-level $set of accountClearing with 403 and does not persist it', async function () {
    await expectRejected403(() => Meteor.users.updateAsync(userId, {$set: {accountClearing: {score: 1}}}));
    expect((await reload()).accountClearing).to.be.undefined;
  });

  it('rejects a dotted sub-path $set of accountClearing.score with 403 (blackbox-invisible depth)', async function () {
    await expectRejected403(() => Meteor.users.updateAsync(userId, {$set: {'accountClearing.score': 9}}));
    expect((await reload()).accountClearing).to.be.undefined;
  });

  it('rejects an $unset of a locked field with 403', async function () {
    await expectRejected403(() => Meteor.users.updateAsync(userId, {$unset: {accountStatus: 1}}));
  });

  it('rejects a replacement document that carries a locked field with 403', async function () {
    await expectRejected403(() => Meteor.users.updateAsync(userId, {accountStatus: 'active', profile: {name: 'X'}}));
    expect((await reload()).accountStatus).to.be.undefined;
  });

  it('rejects an upsertAsync that writes a locked field with 403 (transitive coverage)', async function () {
    await expectRejected403(() => Meteor.users.upsertAsync({_id: userId}, {$set: {accountStatus: 'suspended'}}));
    expect((await reload()).accountStatus).to.be.undefined;
  });

  // CREATE path: insertAsync is INTENTIONALLY NOT locked. The insert-write it
  // would close is a non-reachable / no-privilege minor. So a doc carrying locked fields inserts
  // successfully, and a normal creation insert also succeeds.
  it('allows an insertAsync of a doc carrying locked fields (insert intentionally unlocked)', async function () {
    let insertedId;
    try {
      insertedId = await Meteor.users.insertAsync({
        createdAt: new Date(),
        emails: [{address: 'seed-95@example.com', verified: true}],
        profile: {companyId: 'bwat59Bn6cneY7SRi', name: 'Seed', email: 'seed-95@example.com'},
        accountStatus: 'suspended',
        accountStatusInfo: {action: 'suspend', reason: 'seed', at: new Date(), by: {userId: 'a', name: 'A'}},
        accountClearing: {score: 42, reason: 'auto'}
      });
      expect(insertedId).to.be.a('string');
      const doc = await Meteor.users.findOneAsync(insertedId,
        {fields: {accountStatus: 1, accountStatusInfo: 1, accountClearing: 1}});
      expect(doc.accountStatus).to.equal('suspended');
      expect(doc.accountClearing.score).to.equal(42);
      expect(doc.accountStatusInfo.action).to.equal('suspend');
    } finally {
      if (insertedId) {
        await Meteor.users.removeAsync(insertedId);
      }
    }
  });

  it('allows an insertAsync of a user doc without the locked fields (creation not broken)', async function () {
    let insertedId;
    try {
      insertedId = await Meteor.users.insertAsync({
        createdAt: new Date(),
        emails: [{address: 'plain-95@example.com', verified: true}],
        profile: {companyId: 'bwat59Bn6cneY7SRi', name: 'Plain User', email: 'plain-95@example.com'}
      });
      expect(insertedId).to.be.a('string');
      const doc = await Meteor.users.findOneAsync(insertedId, {fields: {emails: 1}});
      expect(doc.emails[0].address).to.equal('plain-95@example.com');
    } finally {
      if (insertedId) {
        await Meteor.users.removeAsync(insertedId);
      }
    }
  });

  // The self-service user methods keep working for their own fields and cannot
  // be abused to write the locked fields.
  describe('user self-service methods', function () {
    function callMethod(name, ...args) {
      const handler = Meteor.server.method_handlers[name];
      // connection:null marks a trusted server-side invocation (skips the DDP
      // auth/suspension guard), userId provides the acting user.
      return handler.apply({userId: userId, connection: null}, args);
    }

    it('updateUserIntro still writes its own field', async function () {
      await callMethod('updateUserIntro', 'chat', true);
      expect((await reload()).intro.chat).to.be.true;
    });

    it('updateUserConfig cannot target a locked field', async function () {
      let err;
      try {
        await callMethod('updateUserConfig', 'accountStatus', {score: 1});
      } catch (e) {
        err = e;
      }
      expect(err).to.exist;
      expect(err.error).to.equal(400);
      expect((await reload()).accountStatus).to.be.undefined;
    });

    it('updateUserProfile cannot target a locked field', async function () {
      let err;
      try {
        await callMethod('updateUserProfile', {accountStatus: 'suspended'});
      } catch (e) {
        err = e;
      }
      expect(err).to.exist;
      expect(err.error).to.equal(400);
      expect((await reload()).accountStatus).to.be.undefined;
    });
  });
});
