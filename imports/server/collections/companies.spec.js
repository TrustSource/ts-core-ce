
import './companies';
import './logevents';   // registers the `logEvent` method used by apiKey.reveal
import {Meteor} from 'meteor/meteor';
import {Roles} from 'meteor/alanning:roles';
import {expect} from 'chai';
import sinon from 'sinon';
import _ from 'underscore';
import Companies from '/imports/lib/collections/companies';
import LogEvents from '/imports/lib/collections/logevents';
import {encrypt, decrypt, hmac} from '/imports/lib/crypto';
import {upgradeApiKeyEntry} from '/imports/server/security/apiKeyUpgrade';
// Loads the roles 4.0 backwards-compat shim so the server-side `Roles.userIsInRole`
// name that production calls resolves to `Roles.userIsInRoleAsync` (stubbed below).
import '/imports/startup/server/roles-compat';

describe('collections: Companies ', function () {

  const testUser = {
    _id: '3anc4c6udmxKLa4jg',
    profile: {companyId: 'abc'},
    roles: ['manager']
  };

  beforeEach(async function () {
    // Deterministic HMAC/AES key for this spec's assertions (the crypto module
    // reads process.env.TS_ENCRYPTION_KEY fresh on every call).
    process.env.TS_ENCRYPTION_KEY = 'companies-spec-test-encryption-key';
    // Meteor 3 server methods resolve the caller via Meteor.userAsync(); the RBAC
    // gate uses Roles.userIsInRole. Simulate an authorized account_admin.
    sinon.stub(Meteor, 'userAsync').callsFake(async () => testUser);
    sinon.stub(Roles, 'userIsInRoleAsync').callsFake(async () => true);
    // Real throwaway data (hwillson:stub-collections is a gutted no-op shell in
    // Meteor 3, and the server Mongo API is async-only).
    await Companies.removeAsync({});
    await LogEvents.removeAsync({});
  });

  afterEach(async function () {
    delete process.env.TS_ENCRYPTION_KEY;
    Meteor.userAsync.restore();
    Roles.userIsInRoleAsync.restore();
    await Companies.removeAsync({});
    await LogEvents.removeAsync({});
  });

  describe('apiKey.create() should create apiKeys attribute for Company', function () {
    it('should append on entry to apiKeys array', async function () {
      await Companies.insertAsync({_id: 'abc'});

      const data = await Meteor.callAsync('apiKey.create', {scope: ['manager']});

      expect(data).to.exist;
      expect(data.scope).to.deep.equal(['manager']);
      expect(await Companies.find().countAsync()).to.equal(1);
    });

    it('#45 refuses a key without a valid scope', async function () {
      await Companies.insertAsync({_id: 'abc'});
      for (const params of [null, {name: 'x'}, {scope: []}, {scope: 'manager'}, {scope: ['root']}]) {
        let err;
        try {
          await Meteor.callAsync('apiKey.create', params);
        } catch (e) {
          err = e;
        }
        expect(err && err.error, JSON.stringify(params)).to.equal(400);
      }
      expect((await Companies.findOneAsync('abc')).apiKeys).to.be.undefined;
    });

    it('#72 stores the key encrypted (v2:-prefixed) with keyHash/id/maskedKey populated, and never returns the secret to the caller', async function () {
      await Companies.insertAsync({_id: 'abc'});

      const returned = await Meteor.callAsync('apiKey.create', {name: 'my key', scope: ['developer']});

      // Client-facing return never carries the secret material.
      expect(returned.key).to.be.undefined;
      expect(returned.keyHash).to.be.undefined;
      expect(returned.id).to.be.a('string').and.not.empty;
      expect(returned.maskedKey).to.be.a('string');

      const company = await Companies.findOneAsync('abc');
      const stored = company.apiKeys[0];
      expect(stored.key).to.be.a('string');
      expect(stored.key.startsWith('v2:')).to.equal(true);
      expect(stored.key).to.not.equal(stored.id);
      expect(stored.keyHash).to.equal(hmac(decrypt(stored.key)));
      expect(stored.maskedKey).to.equal(returned.maskedKey);
      expect(stored.id).to.equal(returned.id);
    });
  });

  describe('apiKey.create() replay protection (#121 "two keys at once")', function () {
    it('mints one key for a repeated call carrying the same requestId, and returns that same entry', async function () {
      await Companies.insertAsync({_id: 'abc'});

      const first = await Meteor.callAsync('apiKey.create', {name: 'mAIfit web app', scope: ['manager'], requestId: 'intent-1'});
      const replay = await Meteor.callAsync('apiKey.create', {name: 'mAIfit web app', scope: ['manager'], requestId: 'intent-1'});

      const company = await Companies.findOneAsync('abc');
      expect(company.apiKeys.length).to.equal(1);
      expect(replay.id).to.equal(first.id);
      expect(replay.maskedKey).to.equal(first.maskedKey);
      // The replay must not hand the caller secret material either.
      expect(replay.key).to.be.undefined;
      expect(replay.keyHash).to.be.undefined;
    });

    it('mints one key when two calls with the same requestId race', async function () {
      await Companies.insertAsync({_id: 'abc'});

      await Promise.all([
        Meteor.callAsync('apiKey.create', {name: 'racing', scope: ['manager'], requestId: 'intent-race'}),
        Meteor.callAsync('apiKey.create', {name: 'racing', scope: ['manager'], requestId: 'intent-race'})
      ]);

      const company = await Companies.findOneAsync('abc');
      expect(company.apiKeys.length).to.equal(1);
    });

    it('still mints a separate key for a genuinely new intent', async function () {
      await Companies.insertAsync({_id: 'abc'});

      const first = await Meteor.callAsync('apiKey.create', {name: 'one', scope: ['manager'], requestId: 'intent-1'});
      const second = await Meteor.callAsync('apiKey.create', {name: 'two', scope: ['manager'], requestId: 'intent-2'});

      const company = await Companies.findOneAsync('abc');
      expect(company.apiKeys.length).to.equal(2);
      expect(second.id).to.not.equal(first.id);
    });

    it('falls back to a per-call marker when the caller sends no requestId, so old clients keep working', async function () {
      await Companies.insertAsync({_id: 'abc'});

      await Meteor.callAsync('apiKey.create', {name: 'one', scope: ['manager']});
      await Meteor.callAsync('apiKey.create', {name: 'two', scope: ['manager']});

      const company = await Companies.findOneAsync('abc');
      expect(company.apiKeys.length).to.equal(2);
      expect(company.apiKeys[0].requestId).to.not.equal(company.apiKeys[1].requestId);
    });

    it('namespaces the marker per user, so one user\'s token cannot resolve to another user\'s key', async function () {
      await Companies.insertAsync({_id: 'abc'});

      const mine = await Meteor.callAsync('apiKey.create', {name: 'mine', scope: ['manager'], requestId: 'shared-token'});

      // Same token, different caller - must produce a NEW key, not resolve to the first.
      Meteor.userAsync.restore();
      sinon.stub(Meteor, 'userAsync').callsFake(async () => ({
        _id: 'someone-else', profile: {companyId: 'abc'}, roles: ['manager']
      }));
      const theirs = await Meteor.callAsync('apiKey.create', {name: 'theirs', scope: ['manager'], requestId: 'shared-token'});

      const company = await Companies.findOneAsync('abc');
      expect(company.apiKeys.length).to.equal(2);
      expect(theirs.id).to.not.equal(mine.id);
    });

    it('keeps the marker across a client-driven rename (it is server-owned, like id/created)', async function () {
      await Companies.insertAsync({_id: 'abc'});
      const created = await Meteor.callAsync('apiKey.create', {name: 'original', scope: ['manager'], requestId: 'intent-1'});
      const before = (await Companies.findOneAsync('abc')).apiKeys[0].requestId;

      await Meteor.callAsync('apiKey.update', {id: created.id, name: 'renamed'});

      const after = (await Companies.findOneAsync('abc')).apiKeys[0];
      expect(after.name).to.equal('renamed');
      expect(after.requestId).to.equal(before);
    });
  });

  describe('createApiKeyByUser() replay protection (#121)', function () {
    it('mints one personal key for a repeated call carrying the same requestId', async function () {
      await Companies.insertAsync({_id: 'abc'});

      const first = await Meteor.callAsync('createApiKeyByUser', {requestId: 'intent-1'});
      const replay = await Meteor.callAsync('createApiKeyByUser', {requestId: 'intent-1'});

      const company = await Companies.findOneAsync('abc');
      expect(company.apiKeys.length).to.equal(1);
      expect(replay.id).to.equal(first.id);
    });
  });

  describe('getApiKeysByUser() (#72 Finding 2 fix)', function () {
    // getApiKeysByUser resolves the caller via `this.userId` (the DDP
    // connection), not the stubbed Meteor.userAsync() every other method in
    // this file uses - so it needs a real Meteor.users doc + the
    // Meteor.server.method_handlers invocation pattern already established by
    // users.accountStatus.spec.js / security-guard.gaps.spec.js, rather than
    // a plain Meteor.callAsync (which would leave this.userId unset here).
    function callGetApiKeysByUser() {
      const handler = Meteor.server.method_handlers['getApiKeysByUser'];
      return handler.apply({userId: testUser._id, connection: null});
    }

    afterEach(async function () {
      await Meteor.users.removeAsync(testUser._id);
    });

    it('never returns the secret key/keyHash - only non-secret metadata (id/maskedKey/etc)', async function () {
      await Meteor.users.insertAsync({_id: testUser._id, profile: {companyId: 'abc'}});
      await Companies.insertAsync({_id: 'abc'});
      const created = await Meteor.callAsync('createApiKeyByUser', {name: 'personal key'});

      const keys = await callGetApiKeysByUser();

      expect(keys.length).to.equal(1);
      expect('key' in keys[0]).to.equal(false);
      expect('keyHash' in keys[0]).to.equal(false);
      expect(keys[0].id).to.equal(created.id);
      expect(keys[0].maskedKey).to.equal(created.maskedKey);
      expect(keys[0].userId).to.equal(testUser._id);
    });

    it('only returns the calling user\'s own (non-deleted) keys, still stripped of secrets', async function () {
      await Meteor.users.insertAsync({_id: testUser._id, profile: {companyId: 'abc'}});
      await Companies.insertAsync({
        _id: 'abc',
        apiKeys: [
          {id: 'mine', key: 'v2:whatever', keyHash: 'hash1', userId: testUser._id, name: 'mine', published: true},
          {id: 'not-mine', key: 'v2:whatever2', keyHash: 'hash2', userId: 'someone-else', name: 'not mine', published: true},
          {id: 'mine-deleted', key: 'v2:whatever3', keyHash: 'hash3', userId: testUser._id, name: 'deleted', deleted: true}
        ]
      });

      const keys = await callGetApiKeysByUser();

      expect(keys.length).to.equal(1);
      expect(keys[0].id).to.equal('mine');
      expect('key' in keys[0]).to.equal(false);
      expect('keyHash' in keys[0]).to.equal(false);
    });

    it('QA follow-up: self-heals a pre-#72 (legacy, no id/maskedKey) personal key before returning it, ' +
      'so the masked "partial view" column and the copy button work on first load - no operator migration required',
    async function () {
      await Meteor.users.insertAsync({_id: testUser._id, profile: {companyId: 'abc'}});
      await Companies.insertAsync({
        _id: 'abc',
        apiKeys: [{
          // No id/keyHash/maskedKey - the real shape of a legacy personal key.
          key: 'legacy-personal-key-no-id',
          userId: testUser._id,
          name: 'legacy personal key',
          published: true
        }]
      });

      const keys = await callGetApiKeysByUser();

      expect(keys.length).to.equal(1);
      expect(keys[0].id, 'id must be backfilled before the client ever sees this entry').to.be.a('string').and.not.empty;
      expect(keys[0].maskedKey, 'maskedKey must be backfilled so the masked column renders').to.be.a('string').and.not.empty;
      expect('key' in keys[0]).to.equal(false);
      expect('keyHash' in keys[0]).to.equal(false);

      // Persisted, not just computed for this one response.
      const stored = await Companies.findOneAsync('abc');
      expect(stored.apiKeys[0].key.startsWith('v2:')).to.equal(true);
      expect(stored.apiKeys[0].id).to.equal(keys[0].id);
    });
  });

  describe('apiKey.update() identity + secret-field preservation (#72)', function () {
    it('matches the stored entry by id and force-preserves key/keyHash/maskedKey/created across a metadata-only edit', async function () {
      await Companies.insertAsync({_id: 'abc'});
      const created = await Meteor.callAsync('apiKey.create', {name: 'original name', scope: ['manager']});

      const companyBefore = await Companies.findOneAsync('abc');
      const storedBefore = companyBefore.apiKeys[0];

      // Client can no longer see key/keyHash (stripped from apiKey.create's
      // return) - simulate a metadata-only edit (rename) the way the UI would,
      // submitting only the fields it has: id + the new name.
      await Meteor.callAsync('apiKey.update', {id: created.id, name: 'renamed', published: true});

      const companyAfter = await Companies.findOneAsync('abc');
      expect(companyAfter.apiKeys.length).to.equal(1);
      const storedAfter = companyAfter.apiKeys[0];
      expect(storedAfter.name).to.equal('renamed');
      expect(storedAfter.published).to.equal(true);
      // Secret fields must be untouched by the client-supplied (secret-less) object.
      expect(storedAfter.key).to.equal(storedBefore.key);
      expect(storedAfter.keyHash).to.equal(storedBefore.keyHash);
      expect(storedAfter.maskedKey).to.equal(storedBefore.maskedKey);
      expect(storedAfter.created).to.deep.equal(storedBefore.created);
    });
  });

  describe('updateApiKeyByUser() identity + ownership + secret-field preservation (#72)', function () {
    it('matches by id (not key), enforces userId ownership, and force-preserves secret fields', async function () {
      await Companies.insertAsync({_id: 'abc'});
      const created = await Meteor.callAsync('createApiKeyByUser', {name: 'personal key'});

      const companyBefore = await Companies.findOneAsync('abc');
      const storedBefore = companyBefore.apiKeys[0];
      expect(storedBefore.userId).to.equal(testUser._id);

      await Meteor.callAsync('updateApiKeyByUser',
        {id: created.id, userId: testUser._id, published: true, name: 'renamed personal key'});

      const companyAfter = await Companies.findOneAsync('abc');
      const storedAfter = companyAfter.apiKeys[0];
      expect(storedAfter.name).to.equal('renamed personal key');
      expect(storedAfter.published).to.equal(true);
      expect(storedAfter.key).to.equal(storedBefore.key);
      expect(storedAfter.keyHash).to.equal(storedBefore.keyHash);
      expect(storedAfter.maskedKey).to.equal(storedBefore.maskedKey);
    });

    it('rejects updates from a caller who does not own the key', async function () {
      await Companies.insertAsync({_id: 'abc'});
      const created = await Meteor.callAsync('createApiKeyByUser', {name: 'personal key'});

      let error;
      try {
        await Meteor.callAsync('updateApiKeyByUser',
          {id: created.id, userId: 'someone-else', published: true});
      } catch (e) {
        error = e;
      }
      expect(error).to.exist;
      expect(error.error).to.equal(403);
    });
  });

  describe('apiKey.reveal() (#72)', function () {
    async function seedPublishedKey(companyId, plainKey, extra) {
      const entry = Object.assign({
        created: new Date(),
        id: 'key-id-' + companyId,
        key: encrypt(plainKey),
        keyHash: hmac(plainKey),
        maskedKey: 'a1b2...cdef',
        name: 'a key',
        published: true
      }, extra);
      await Companies.insertAsync({_id: companyId, apiKeys: [entry]});
      return entry;
    }

    it('returns the decrypted plaintext and writes an audit log entry', async function () {
      const plainKey = 'a1b2c3d4-1111-2222-3333-aaaaaaaacdef';
      const entry = await seedPublishedKey('abc', plainKey);

      const result = await Meteor.callAsync('apiKey.reveal', entry.id);

      expect(result).to.equal(plainKey);
      const logs = await LogEvents.find({type: 'apiKeyProcessing'}).fetchAsync();
      expect(logs.length).to.equal(1);
      expect(logs[0].message).to.contain('copied');
      expect(logs[0].message).to.contain(entry.maskedKey);
    });

    it('rejects a caller who is not account_admin', async function () {
      Roles.userIsInRoleAsync.callsFake(async () => false);
      const entry = await seedPublishedKey('abc', 'a1b2c3d4-0000-0000-0000-000000000000');

      let error;
      try {
        await Meteor.callAsync('apiKey.reveal', entry.id);
      } catch (e) {
        error = e;
      }
      expect(error).to.exist;
      expect(error.error).to.equal(403);
    });

    it('rejects a key that belongs to a different company (cross-tenant)', async function () {
      // testUser.profile.companyId === 'abc'; seed the key under a different company.
      const entry = await seedPublishedKey('other-company', 'a1b2c3d4-9999-9999-9999-999999999999');
      await Companies.insertAsync({_id: 'abc'});

      let error;
      try {
        await Meteor.callAsync('apiKey.reveal', entry.id);
      } catch (e) {
        error = e;
      }
      expect(error).to.exist;
      expect(error.error).to.equal(404);
    });

    it('rejects an unpublished key', async function () {
      await Companies.insertAsync({
        _id: 'abc',
        apiKeys: [{
          created: new Date(),
          id: 'unpublished-key',
          key: encrypt('a1b2c3d4-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
          keyHash: hmac('a1b2c3d4-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
          maskedKey: 'a1b2...aaaa',
          name: 'unpublished',
          published: false
        }]
      });

      let error;
      try {
        await Meteor.callAsync('apiKey.reveal', 'unpublished-key');
      } catch (e) {
        error = e;
      }
      expect(error).to.exist;
      expect(error.error).to.equal(404);
    });

    it('rejects a deleted key', async function () {
      await Companies.insertAsync({
        _id: 'abc',
        apiKeys: [{
          created: new Date(),
          id: 'deleted-key',
          key: encrypt('a1b2c3d4-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
          keyHash: hmac('a1b2c3d4-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
          maskedKey: 'a1b2...bbbb',
          name: 'deleted',
          published: true,
          deleted: true
        }]
      });

      let error;
      try {
        await Meteor.callAsync('apiKey.reveal', 'deleted-key');
      } catch (e) {
        error = e;
      }
      expect(error).to.exist;
      expect(error.error).to.equal(404);
    });

    it('rejects a non-string/empty id', async function () {
      await Companies.insertAsync({_id: 'abc'});
      let error;
      try {
        await Meteor.callAsync('apiKey.reveal', '');
      } catch (e) {
        error = e;
      }
      expect(error).to.exist;
      expect(error.error).to.equal(400);
    });

    it('a pre-migration entry with no id field at all self-heals (via companyFull/getApiKeysByUser) and is then ' +
      'revealable with the resulting id - QA follow-up: reveal must not stay gated behind an operator-run migration',
    async function () {
      const plainKey = 'legacy-plaintext-key-no-id-field';
      await Companies.insertAsync({
        _id: 'abc',
        apiKeys: [{
          created: new Date(),
          // No id/keyHash/maskedKey - the real shape of a legacy apiKeys entry.
          key: plainKey,
          name: 'legacy unmigrated key',
          published: true
        }]
      });
      const legacyEntry = (await Companies.findOneAsync('abc')).apiKeys[0];

      // Simulates what companyFull's publish handler / getApiKeysByUser now
      // do on every read: self-heal any legacy entry before the client ever
      // sees it, so a real `id` is always what gets submitted to reveal.
      const upgraded = await upgradeApiKeyEntry('abc', legacyEntry);

      const result = await Meteor.callAsync('apiKey.reveal', upgraded.id);

      expect(result).to.equal(plainKey);
    });

    it('defensively self-heals a legacy entry matched by id directly inside apiKey.reveal itself ' +
      '(belt-and-suspenders even though companyFull/getApiKeysByUser upgrade first in normal operation)',
    async function () {
      const plainKey = 'a1b2c3d4-halfmigrated-halfmigrated';
      await Companies.insertAsync({
        _id: 'abc',
        apiKeys: [{
          created: new Date(),
          id: 'half-migrated-id',   // has an id, but key is still genuinely plaintext
          key: plainKey,
          name: 'half-migrated key',
          published: true
        }]
      });

      const result = await Meteor.callAsync('apiKey.reveal', 'half-migrated-id');

      expect(result).to.equal(plainKey);
      const stored = await Companies.findOneAsync('abc');
      const entry = stored.apiKeys[0];
      expect(entry.key.startsWith('v2:'), 'apiKey.reveal must persist the upgrade, not just decrypt in memory').to.equal(true);
      expect(entry.keyHash).to.equal(hmac(plainKey));
      expect(entry.maskedKey).to.be.a('string').and.not.empty;
    });

    it('id collision: Mongo\'s positional $ projection resolves to the FIRST array entry sharing the id, ' +
      'so an unpublished first entry 404s even if a later entry with the same id is published', async function () {
      const plainA = 'a1b2c3d4-aaaa-1111-1111-aaaaaaaaaaaa';
      const plainB = 'a1b2c3d4-bbbb-2222-2222-bbbbbbbbbbbb';
      await Companies.insertAsync({
        _id: 'abc',
        apiKeys: [
          {created: new Date(), id: 'dup-id', key: encrypt(plainA), keyHash: hmac(plainA),
            maskedKey: 'a1b2...aaaa', name: 'first (unpublished)', published: false},
          {created: new Date(), id: 'dup-id', key: encrypt(plainB), keyHash: hmac(plainB),
            maskedKey: 'a1b2...bbbb', name: 'second (published)', published: true}
        ]
      });

      let error;
      try {
        await Meteor.callAsync('apiKey.reveal', 'dup-id');
      } catch (e) {
        error = e;
      }
      expect(error, 'index-0 entry is unpublished, so it 404s regardless of the second entry').to.exist;
      expect(error.error).to.equal(404);
    });

    it('id collision: when the FIRST entry sharing the id is published, that one (not a later duplicate) is revealed', async function () {
      const plainA = 'a1b2c3d4-cccc-3333-3333-cccccccccccc';
      const plainB = 'a1b2c3d4-dddd-4444-4444-dddddddddddd';
      await Companies.insertAsync({
        _id: 'abc',
        apiKeys: [
          {created: new Date(), id: 'dup-id-2', key: encrypt(plainA), keyHash: hmac(plainA),
            maskedKey: 'a1b2...cccc', name: 'first (published)', published: true},
          {created: new Date(), id: 'dup-id-2', key: encrypt(plainB), keyHash: hmac(plainB),
            maskedKey: 'a1b2...dddd', name: 'second (also published)', published: true}
        ]
      });

      const result = await Meteor.callAsync('apiKey.reveal', 'dup-id-2');
      expect(result).to.equal(plainA);
    });

    // The copy-to-clipboard flow feeds this method's return value straight into
    // a Blob, and `new Blob([undefined])` stringifies to the literal text
    // "undefined" - so a silently-undefined return lands in the user's
    // clipboard as the nine characters "undefined" alongside a
    // "successfully copied" toast. Every path that cannot produce plaintext
    // must therefore throw, never return a falsy value.
    describe('never resolves with a non-plaintext value (silent-undefined guard)', function () {
      it('throws when the stored ciphertext cannot be decrypted with the current TS_ENCRYPTION_KEY', async function () {
        const entry = await seedPublishedKey('abc', 'a1b2c3d4-1111-2222-3333-aaaaaaaacdef');
        // Simulates the real-world trigger: the entry was encrypted under a
        // different secret than the one the server now runs with (key rotated,
        // TS_ENCRYPTION_KEY introduced after the data was written, or a
        // database restored from another environment).
        process.env.TS_ENCRYPTION_KEY = 'a-completely-different-encryption-key';
        expect(decrypt(entry.key), 'precondition: this ciphertext must now be undecryptable').to.equal(undefined);

        let error;
        try {
          await Meteor.callAsync('apiKey.reveal', entry.id);
        } catch (e) {
          error = e;
        }
        expect(error, 'must throw rather than resolve with undefined').to.exist;
        expect(error.error).to.equal(500);
      });

      it('throws when the entry carries no key at all instead of resolving with undefined', async function () {
        await Companies.insertAsync({
          _id: 'abc',
          apiKeys: [{
            created: new Date(),
            id: 'keyless-entry',
            // No `key` field: the shape left behind if a write path ever
            // persisted the result of a failed encrypt() (encrypt returns
            // undefined on error) next to a live keyHash/maskedKey.
            keyHash: 'deadbeef',
            maskedKey: 'a1b2...cdef',
            name: 'keyless',
            published: true
          }]
        });

        let error;
        try {
          await Meteor.callAsync('apiKey.reveal', 'keyless-entry');
        } catch (e) {
          error = e;
        }
        expect(error, 'must throw rather than resolve with undefined').to.exist;
        expect(error.error).to.equal(500);
      });

      it('does not write a "copied" audit entry when no plaintext could be produced', async function () {
        const entry = await seedPublishedKey('abc', 'a1b2c3d4-9999-8888-7777-666655554444');
        process.env.TS_ENCRYPTION_KEY = 'a-completely-different-encryption-key';

        let error;
        try {
          await Meteor.callAsync('apiKey.reveal', entry.id);
        } catch (e) {
          error = e;
        }
        expect(error).to.exist;

        const logs = await LogEvents.find({type: 'apiKeyProcessing'}).fetchAsync();
        expect(logs.length, 'a failed reveal is not a key disclosure, so it must not be logged as one').to.equal(0);
      });
    });

    it('handles two concurrent reveal calls for the same key without corrupting the audit trail', async function () {
      const plainKey = 'a1b2c3d4-5555-6666-7777-888899990000';
      const entry = await seedPublishedKey('abc', plainKey);

      const [r1, r2] = await Promise.all([
        Meteor.callAsync('apiKey.reveal', entry.id),
        Meteor.callAsync('apiKey.reveal', entry.id)
      ]);

      expect(r1).to.equal(plainKey);
      expect(r2).to.equal(plainKey);
      const logs = await LogEvents.find({type: 'apiKeyProcessing'}).fetchAsync();
      expect(logs.length).to.equal(2);
    });

    describe('ownership model for personal (userId-owned) vs company-wide keys (Finding 1 fix)', function () {
      it('a non-admin user can reveal their OWN personal key (no admin required)', async function () {
        Roles.userIsInRoleAsync.callsFake(async () => false);
        const plainKey = 'a1b2c3d4-owna-owna-owna-ownaownaowna';
        const entry = await seedPublishedKey('abc', plainKey, {userId: testUser._id});

        const result = await Meteor.callAsync('apiKey.reveal', entry.id);

        expect(result).to.equal(plainKey);
      });

      it('a non-admin user CANNOT reveal a personal key owned by someone else', async function () {
        Roles.userIsInRoleAsync.callsFake(async () => false);
        const entry = await seedPublishedKey('abc', 'a1b2c3d4-othr-othr-othr-othrothrothr',
          {userId: 'some-other-user-id'});

        let error;
        try {
          await Meteor.callAsync('apiKey.reveal', entry.id);
        } catch (e) {
          error = e;
        }
        expect(error).to.exist;
        expect(error.error).to.equal(403);
      });

      it('an account_admin CANNOT reveal a personal key owned by someone else (no admin override) - ' +
        'this is the exact case a looser isAdmin||isOwner check would get wrong', async function () {
        // Roles stub defaults to true (account_admin) from the outer beforeEach.
        const entry = await seedPublishedKey('abc', 'a1b2c3d4-admn-admn-admn-admnadmnadmn',
          {userId: 'some-other-user-id'});

        let error;
        try {
          await Meteor.callAsync('apiKey.reveal', entry.id);
        } catch (e) {
          error = e;
        }
        expect(error).to.exist;
        expect(error.error).to.equal(403);
      });

      it('an account_admin CAN reveal a company-wide key (no userId) - unchanged baseline', async function () {
        // Roles stub defaults to true (account_admin) from the outer beforeEach.
        const plainKey = 'a1b2c3d4-comp-comp-comp-compcompcomp';
        const entry = await seedPublishedKey('abc', plainKey);   // no userId - company-wide

        const result = await Meteor.callAsync('apiKey.reveal', entry.id);

        expect(result).to.equal(plainKey);
      });
    });
  });

  describe('apiKey.one() hash-only lookup (same as RestApi.js)', function () {
    it('matches an already-migrated (v2:-encrypted) key via the keyHash-based lookup and echoes back the decrypted plaintext', async function () {
      const plainKey = 'a1b2c3d4-onehash-onehash-onehash';
      await Companies.insertAsync({
        _id: 'abc',
        apiKeys: [{
          id: 'one-1', key: encrypt(plainKey), keyHash: hmac(plainKey),
          maskedKey: 'a1b2...hash', name: 'migrated', published: true
        }]
      });

      const found = await Meteor.callAsync('apiKey.one', plainKey);

      expect(found).to.exist;
      expect(found.key).to.equal(plainKey);
      expect('keyHash' in found).to.equal(false);
    });

    it('does not resolve a key stored without its hash (legacy plaintext entry)', async function () {
      const plainKey = 'not-yet-migrated-plaintext-key';
      await Companies.insertAsync({
        _id: 'abc',
        apiKeys: [{id: 'one-2', key: plainKey, name: 'not yet migrated', published: true}]
      });

      let error;
      try {
        await Meteor.callAsync('apiKey.one', plainKey);
      } catch (e) {
        error = e;
      }
      expect(error).to.exist;
      expect(error.error).to.equal(404);
    });

    it('404s for a truly unknown key (unchanged)', async function () {
      await Companies.insertAsync({_id: 'abc'});

      let error;
      try {
        await Meteor.callAsync('apiKey.one', 'totally-unknown-key-value');
      } catch (e) {
        error = e;
      }
      expect(error).to.exist;
      expect(error.error).to.equal(404);
    });
  });

  describe('apiKey.logActivity() id/key matching (#72 deliberate transitional fallback)', function () {
    beforeEach(function () {
      // apiKey.logActivity is internal-only: `if (await Meteor.userAsync()) throw 403`
      // (companies.js) rejects any authenticated DDP caller outright. Override the
      // outer beforeEach's authenticated-testUser stub for just this block, so these
      // calls hit the id/key-matching logic instead of the 403 guard.
      Meteor.userAsync.callsFake(async () => null);
    });

    it('matches by id when the target object carries one, even if two entries share the same key value', async function () {
      await Companies.insertAsync({
        _id: 'abc',
        apiKeys: [
          {id: 'id-a', key: 'same-literal-key-value', name: 'A', published: true},
          {id: 'id-b', key: 'same-literal-key-value', name: 'B', published: true}
        ]
      });

      await Meteor.callAsync('apiKey.logActivity', 'abc',
        {id: 'id-b', key: 'same-literal-key-value', lastUsedDate: new Date('2020-01-01')});

      const company = await Companies.findOneAsync('abc');
      const a = _.findWhere(company.apiKeys, {id: 'id-a'});
      const b = _.findWhere(company.apiKeys, {id: 'id-b'});
      expect(a.lastUsedDate).to.be.undefined;
      expect(b.lastUsedDate).to.exist;
    });

    it('falls back to key-match when apiKey.id is falsy (pre-migration entry, no id field yet)', async function () {
      await Companies.insertAsync({
        _id: 'abc',
        apiKeys: [
          {key: 'legacy-key-one', name: 'legacy one', published: true},
          {key: 'legacy-key-two', name: 'legacy two', published: true}
        ]
      });

      // Simulates what RestApi.getKeyMetaAndCompanyByAccountAndApiKey builds for
      // an un-migrated (id-less) match: keyMeta.id is undefined.
      await Meteor.callAsync('apiKey.logActivity', 'abc',
        {key: 'legacy-key-two', lastUsedDate: new Date('2020-01-01')});

      const company = await Companies.findOneAsync('abc');
      const one = _.findWhere(company.apiKeys, {key: 'legacy-key-one'});
      const two = _.findWhere(company.apiKeys, {key: 'legacy-key-two'});
      expect(one.lastUsedDate).to.be.undefined;
      expect(two.lastUsedDate).to.exist;
    });

    it('does not let id-falsy matching touch every id-less entry (the exact corruption risk the fallback guards against)', async function () {
      await Companies.insertAsync({
        _id: 'abc',
        apiKeys: [
          {key: 'legacy-key-alpha', name: 'alpha', published: true},
          {key: 'legacy-key-beta', name: 'beta', published: true},
          {key: 'legacy-key-gamma', name: 'gamma', published: true}
        ]
      });

      await Meteor.callAsync('apiKey.logActivity', 'abc',
        {key: 'legacy-key-beta', lastUsedDate: new Date('2020-01-01')});

      const company = await Companies.findOneAsync('abc');
      const touched = _.filter(company.apiKeys, function (k) { return !!k.lastUsedDate; });
      expect(touched.length, 'only the key-matched entry should be updated, not every id-less entry').to.equal(1);
      expect(touched[0].key).to.equal('legacy-key-beta');
    });
  });

  describe('getModulesHistory()', function () {

    it('should work', async function () {
      await Companies.insertAsync({
        _id: 'abc', statistics: [
          {
            'date': new Date('2015-12-14T14:47:50.193Z'),
            'components': {
              'warnings': 238,
              'violations': 499,
              'total': 415
            },
            'licenses': {
              'warnings': 0,
              'violations': 35,
              'total': 35
            },
            'modules': {
              'warnings': 0,
              'violations': 4,
              'total': 4
            }
          },
          {
            'date': new Date('2015-12-18T12:29:22.279Z'),
            'components': {
              'warnings': 238,
              'violations': 499,
              'total': 415
            },
            'licenses': {
              'warnings': 0,
              'violations': 35,
              'total': 35
            },
            'modules': {
              'warnings': 0,
              'violations': 4,
              'total': 4
            }
          }]

      });

      const data = await Meteor.callAsync('getModulesHistory');
      expect(data.unit).to.be.equal('months');
      expect(data.history.length).to.be.equal(2);
    });
  });
});
