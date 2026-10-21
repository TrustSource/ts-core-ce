import './users';
import {Meteor} from 'meteor/meteor';
import {expect} from 'chai';

// Gap coverage for the Meteor.users.updateAsync write-lock.
//
// users.accountStatus.spec.js already covers: reject top-level $set of each locked
// field, dotted accountClearing.score, $unset, replacement doc, upsertAsync of a
// locked field, and that the self-service methods keep working. These add the
// cases NOT covered there:
//   - the FALSE-POSITIVE / self-DoS guard: legitimate writes to unrelated fields
//     (profile.name, roles.<companyId>, services.resume.*) must pass THROUGH the
//     wrapper and persist (a too-broad lock would brick normal user writes).
//   - additional operators ($push, $addToSet, $setOnInsert) and a deep dotted
//     locked sub-path, exercised against the real collection.
//   - insertAsync of the locked fields is ALLOWED (insert is intentionally
//     NOT locked; no ts-app insert path accepts them from a client); a normal
//     insert also succeeds.
//     External seeding happens via raw Mongo in other processes and is unaffected.
describe('collections: users account-status write-lock gaps (#95)', function () {

  const COMPANY_ID = 'bwat59Bn6cneY7SRi';
  let userId;

  beforeEach(async function () {
    userId = await Meteor.users.insertAsync({
      createdAt: new Date(),
      emails: [{address: 'lock-gap-95@example.com', verified: true}],
      profile: {
        companyId: COMPANY_ID,
        name: 'Lock Gap',
        email: 'lock-gap-95@example.com'
      }
    });
  });

  afterEach(async function () {
    if (userId) {
      await Meteor.users.removeAsync(userId);
      userId = undefined;
    }
  });

  function reload(fields) {
    return Meteor.users.findOneAsync(userId, {fields: fields});
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

  // --- The lock must NOT block legitimate writes (self-DoS regression guard) ---
  describe('does not block legitimate (non-locked) writes', function () {
    it('allows a $set of profile.name and persists it', async function () {
      const changed = await Meteor.users.updateAsync(userId, {$set: {'profile.name': 'Renamed User'}});
      expect(changed).to.equal(1);
      expect((await reload({profile: 1})).profile.name).to.equal('Renamed User');
    });

    it('allows a $set of roles.<companyId> and persists it', async function () {
      const changed = await Meteor.users.updateAsync(userId, {$set: {['roles.' + COMPANY_ID]: ['manager']}});
      expect(changed).to.equal(1);
      expect((await reload({roles: 1})).roles[COMPANY_ID]).to.deep.equal(['manager']);
    });

    it('allows a $set of services.resume.loginTokens and persists it', async function () {
      const changed = await Meteor.users.updateAsync(userId, {$set: {'services.resume.loginTokens': []}});
      expect(changed).to.equal(1);
      const reloaded = await reload({services: 1});
      expect(reloaded.services.resume.loginTokens).to.deep.equal([]);
    });

    it('allows a $set of intro.chat (direct updateAsync) and persists it', async function () {
      const changed = await Meteor.users.updateAsync(userId, {$set: {'intro.chat': true}});
      expect(changed).to.equal(1);
      expect((await reload({intro: 1})).intro.chat).to.be.true;
    });
  });

  // --- Additional operators / depths against the real collection ---
  describe('rejects additional locked-field operators', function () {
    it('rejects a $push targeting a locked field with 403', async function () {
      await expectRejected403(() => Meteor.users.updateAsync(userId, {$push: {accountClearing: {score: 1}}}));
      expect((await reload({accountClearing: 1})).accountClearing).to.be.undefined;
    });

    it('rejects an $addToSet targeting a dotted locked sub-path with 403', async function () {
      await expectRejected403(() =>
        Meteor.users.updateAsync(userId, {$addToSet: {'accountStatusInfo.history': {at: 1}}}));
      expect((await reload({accountStatusInfo: 1})).accountStatusInfo).to.be.undefined;
    });

    it('rejects a deep dotted $set of accountStatusInfo.by.userId with 403', async function () {
      await expectRejected403(() =>
        Meteor.users.updateAsync(userId, {$set: {'accountStatusInfo.by.userId': 'attacker'}}));
      expect((await reload({accountStatusInfo: 1})).accountStatusInfo).to.be.undefined;
    });

    it('rejects an upsertAsync $setOnInsert of a locked field with 403', async function () {
      await expectRejected403(() =>
        Meteor.users.upsertAsync(userId, {$setOnInsert: {accountStatus: 'suspended'}, $set: {'profile.name': 'X2'}}));
      expect((await reload({accountStatus: 1})).accountStatus).to.be.undefined;
    });
  });

  // --- insertAsync of locked fields is ALLOWED (insert intentionally unlocked) ---
  // The lock covers UPDATE/UPSERT only; insert is intentionally left open.
  describe('insertAsync is not affected by the write-lock', function () {
    it('allows inserting a NEW user document carrying all three locked fields', async function () {
      let insertedId;
      try {
        insertedId = await Meteor.users.insertAsync({
          createdAt: new Date(),
          emails: [{address: 'seed-gap-95@example.com', verified: true}],
          profile: {companyId: COMPANY_ID, name: 'Seed Gap', email: 'seed-gap-95@example.com'},
          accountStatus: 'suspended',
          accountStatusInfo: {action: 'suspend', reason: 'seed', at: new Date(), by: {userId: 'admin', name: 'A'}},
          accountClearing: {score: 42, reason: 'auto'}
        });
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

    it('allows inserting a NEW user document WITHOUT the locked fields (creation not broken)', async function () {
      let insertedId;
      try {
        insertedId = await Meteor.users.insertAsync({
          createdAt: new Date(),
          emails: [{address: 'plain-gap-95@example.com', verified: true}],
          profile: {companyId: COMPANY_ID, name: 'Plain Gap', email: 'plain-gap-95@example.com'}
        });
        expect(insertedId).to.be.a('string');
        const doc = await Meteor.users.findOneAsync(insertedId, {fields: {emails: 1}});
        expect(doc.emails[0].address).to.equal('plain-gap-95@example.com');
      } finally {
        if (insertedId) {
          await Meteor.users.removeAsync(insertedId);
        }
      }
    });
  });
});
