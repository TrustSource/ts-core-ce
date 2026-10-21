
import './companies';   // registers the companyFull publication
import '/imports/startup/server/roles-compat';
import {Meteor} from 'meteor/meteor';
import {Roles} from 'meteor/alanning:roles';
import {expect} from 'chai';
import sinon from 'sinon';
import Companies from '/imports/lib/collections/companies';
import {encrypt, hmac} from '/imports/lib/crypto';

// AC3: the `companyFull` publication (subscribed to by the account_admin
// settings UI) must never put apiKeys[].key / apiKeys[].keyHash on the wire,
// even though the rest of the apiKeys entry (id, name, scope, published/deleted
// flags, maskedKey, externalId, lastUsedDate, created, userId) must keep flowing
// so the settings UI can still list/manage keys. The legacy per-company service
// keys (externalApiKeys, no longer used) must not appear at all.
//
// This is a projection-correctness bug class: get the field-exclusion map
// wrong (typo a field name, drop a secret field, etc.) and the
// publication silently starts leaking ciphertext (or worse, a plaintext
// pre-migration value) to every account_admin's browser with no functional
// break to signal it - a unit test on the actual data flowing through the
// wire-level projection is the only thing that would catch that class of bug.
//
// This repo has a precedent for invoking a raw publish handler directly (see
// imports/startup/server/security-guard.gaps.spec.js, which reads
// Meteor.server.publish_handlers['companyUsers'] and calls it with a fake
// `this`). Reused here.
describe('publications: companyFull excludes apiKey secret fields and legacy externalApiKeys (#72 AC3)', function () {
  const companyId = 'zzsec-pubfull-co';
  let userId;

  beforeEach(async function () {
    process.env.TS_ENCRYPTION_KEY = 'companyfull-pub-spec-test-key';
    sinon.stub(Roles, 'userIsInRoleAsync').callsFake(async () => true);
    userId = await Meteor.users.insertAsync({
      createdAt: new Date(),
      emails: [{address: 'pubfull-72@example.com', verified: true}],
      profile: {companyId: companyId, name: 'Pub Full Test'}
    });
    // Raw insert: externalApiKeys is no longer in the company schema, so a
    // schema-validated insert would strip the legacy data this spec must see redacted.
    await Companies.rawCollection().insertOne({
      _id: companyId,
      apiKeys: [{
        id: 'k1',
        key: encrypt('plain-apikey-secret'),
        keyHash: hmac('plain-apikey-secret'),
        maskedKey: 'plai...cret',
        name: 'a key',
        published: true,
        created: new Date()
      }],
      externalApiKeys: {
        vulnerability: {id: 'ext-vuln', value: encrypt('plain-vuln-secret'), valueHash: hmac('plain-vuln-secret')},
        psirt: {id: 'ext-ps', value: encrypt('plain-psirt-secret'), valueHash: hmac('plain-psirt-secret')},
        'psirt-transactions': {
          id: 'ext-pst',
          value: encrypt('plain-psirt-tx-secret'),
          valueHash: hmac('plain-psirt-tx-secret')
        }
      }
    });
  });

  afterEach(async function () {
    delete process.env.TS_ENCRYPTION_KEY;
    Roles.userIsInRoleAsync.restore();
    await Meteor.users.removeAsync(userId);
    await Companies.removeAsync({_id: companyId});
  });

  it('never puts apiKeys.key/keyHash or any legacy externalApiKeys through the wire-level projection', async function () {
    const handler = Meteor.server.publish_handlers['companyFull'];
    expect(handler, 'companyFull publication must be registered').to.be.a('function');

    const cursor = await handler.call({userId: userId, ready: sinon.spy()});
    expect(cursor, 'expected a live cursor for an authorized account_admin, not this.ready()').to.exist;
    expect(typeof cursor.fetchAsync).to.equal('function');

    const docs = await cursor.fetchAsync();
    expect(docs.length).to.equal(1);
    const company = docs[0];

    // Secret material must be absent, not just falsy - `in` proves the key was
    // never serialized at all (a `key: undefined` would still pass `!company.apiKeys[0].key`).
    expect('key' in company.apiKeys[0]).to.equal(false);
    expect('keyHash' in company.apiKeys[0]).to.equal(false);
    expect('externalApiKeys' in company, 'legacy externalApiKeys must be excluded entirely').to.equal(false);

    // Non-secret metadata must still flow - the settings UI needs it to list/manage keys.
    expect(company.apiKeys[0].id).to.equal('k1');
    expect(company.apiKeys[0].maskedKey).to.equal('plai...cret');
    expect(company.apiKeys[0].name).to.equal('a key');
    expect(company.apiKeys[0].published).to.equal(true);
  });

  it('this.ready()s with no data for a non-admin subscriber (unchanged pre-#72 auth behaviour)', async function () {
    Roles.userIsInRoleAsync.callsFake(async () => false);
    const readySpy = sinon.spy();

    const result = await Meteor.server.publish_handlers['companyFull'].call({userId: userId, ready: readySpy});

    expect(readySpy.calledOnce, 'a non-admin subscriber must get this.ready(), never a cursor').to.be.true;
    expect(result).to.be.undefined;
  });

  describe('self-heals a pre-#72 (legacy) apiKeys entry before returning the cursor (QA gap: masked view/copy broken until TS_REENCRYPT_SECRETS)', function () {
    const legacyCompanyId = 'zzsec-pubfull-legacy-co';

    beforeEach(async function () {
      await Companies.insertAsync({
        _id: legacyCompanyId,
        apiKeys: [{
          // No id/keyHash/maskedKey at all - the real shape of a legacy apiKeys
          // entry that was never touched since.
          key: 'legacy-plaintext-key-no-id-field',
          name: 'pre-#72 legacy key',
          published: true,
          created: new Date()
        }]
      });
    });

    afterEach(async function () {
      await Companies.removeAsync({_id: legacyCompanyId});
    });

    it('the published doc already has id/maskedKey populated on first subscribe, with no operator migration run', async function () {
      // The publish handler resolves companyId from the subscriber's own user
      // doc - repoint the test user at the legacy company for this test.
      await Meteor.users.updateAsync(userId, {$set: {'profile.companyId': legacyCompanyId}});

      const cursor = await Meteor.server.publish_handlers['companyFull'].call({userId: userId, ready: sinon.spy()});
      const docs = await cursor.fetchAsync();

      expect(docs.length).to.equal(1);
      const entry = docs[0].apiKeys[0];
      expect(entry.id, 'id must be backfilled before the cursor is returned').to.be.a('string').and.not.empty;
      expect(entry.maskedKey, 'maskedKey must be backfilled before the cursor is returned').to.be.a('string').and.not.empty;
      expect('key' in entry).to.equal(false);
      expect('keyHash' in entry).to.equal(false);

      // Persisted, not just computed for this one response.
      const stored = await Companies.findOneAsync(legacyCompanyId);
      expect(stored.apiKeys[0].key.startsWith('v2:')).to.equal(true);
      expect(stored.apiKeys[0].keyHash).to.be.a('string').and.not.empty;
      expect(stored.apiKeys[0].id).to.equal(entry.id);
    });
  });
});
