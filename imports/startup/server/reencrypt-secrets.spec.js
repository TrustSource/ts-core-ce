import {runReencryption} from './reencrypt-secrets';
import {expect} from 'chai';
import sinon from 'sinon';
import Companies from '/imports/lib/collections/companies';
import Webhooks from '/imports/lib/collections/webhooks';
import {encrypt, decrypt, decryptV2Only, hmac} from '/imports/lib/crypto';

// Migration coverage for the apiKeys[] field
// (AC11-AC14). runReencryption() is the exported orchestrator that
// Meteor.startup() also calls - testing it directly avoids relying on
// server-boot timing for the TS_REENCRYPT_SECRETS env var.
describe('reencrypt-secrets: apiKeys (#72)', function () {
  const PLAIN_KEY = 'a1b2c3d4-1111-2222-3333-444444444444';

  beforeEach(async function () {
    process.env.TS_ENCRYPTION_KEY = 'reencrypt-spec-test-key';
    await Companies.removeAsync({});
  });

  afterEach(async function () {
    delete process.env.TS_ENCRYPTION_KEY;
    delete process.env.TS_REENCRYPT_SECRETS;
    await Companies.removeAsync({});
  });

  async function seedMixedCompany() {
    await Companies.insertAsync({
      _id: 'zzsec-migrate-co',
      apiKeys: [
        {id: 'k1', key: PLAIN_KEY, name: 'plain key', published: true},
        {id: 'k2', key: encrypt('already-migrated-key'), keyHash: hmac('already-migrated-key'),
          maskedKey: 'alre...key0', name: 'already v2', published: true}
      ]
    });
  }

  it('AC14: aborts without writing when TS_ENCRYPTION_KEY is unset, and logs a warning', async function () {
    await seedMixedCompany();
    delete process.env.TS_ENCRYPTION_KEY;

    const result = await runReencryption('true');

    expect(result).to.equal(null);
    const company = await Companies.findOneAsync('zzsec-migrate-co');
    expect(company.apiKeys[0].key).to.equal(PLAIN_KEY);
  });

  it('AC11: dry-run writes nothing and reports correct migrated/skipped counts', async function () {
    await seedMixedCompany();

    const result = await runReencryption('dry');

    expect(result.apiKeys.migrated).to.equal(1);
    expect(result.apiKeys.skipped).to.equal(1);
    expect(result.apiKeys.failed).to.equal(0);
    expect(result.externalApiKeys).to.be.undefined;

    // Nothing written.
    const company = await Companies.findOneAsync('zzsec-migrate-co');
    expect(company.apiKeys[0].key).to.equal(PLAIN_KEY);
    expect(company.apiKeys[0].keyHash).to.be.undefined;
  });

  it('AC12: real run encrypts plaintext to v2:, round-trips to the original plaintext, ' +
    'leaves already-v2 byte-identical', async function () {
    await seedMixedCompany();
    const before = await Companies.findOneAsync('zzsec-migrate-co');
    const alreadyV2Key = before.apiKeys[1].key;

    await runReencryption('true');

    const after = await Companies.findOneAsync('zzsec-migrate-co');
    const migratedEntry = after.apiKeys.find((k) => k.id === 'k1');
    expect(migratedEntry.key.startsWith('v2:')).to.equal(true);
    expect(decrypt(migratedEntry.key)).to.equal(PLAIN_KEY);
    expect(migratedEntry.keyHash).to.equal(hmac(PLAIN_KEY));
    expect(migratedEntry.maskedKey).to.be.a('string');

    const untouchedEntry = after.apiKeys.find((k) => k.id === 'k2');
    expect(untouchedEntry.key).to.equal(alreadyV2Key);
  });

  it('AC13: re-running in real mode after a completed run is idempotent (migrated=0)', async function () {
    await seedMixedCompany();
    await runReencryption('true');

    const result = await runReencryption('true');

    expect(result.apiKeys.migrated).to.equal(0);
    expect(result.apiKeys.skipped).to.equal(2);
  });

  it('does nothing when TS_REENCRYPT_SECRETS is unset', async function () {
    const result = await runReencryption(undefined);
    expect(result).to.equal(null);
  });

  it('backfills a fresh id/keyHash/maskedKey for a genuinely pre-#72 apiKeys entry with NO id field at all', async function () {
    // seedMixedCompany() (AC12 above) always pre-seeds an `id` on both entries,
    // even the "plain" one - that is NOT the real shape of legacy data.
    // A truly pre-migration entry (created by the old
    // apiKey.create, before id/keyHash/maskedKey existed in the schema) has no
    // id field at all, so the `entry.id || uuid.v4()` backfill branch needs its
    // own coverage.
    const plainKey = 'a1b2c3d4-noid-0000-0000-000000000000';
    await Companies.insertAsync({
      _id: 'zzsec-migrate-noid-co',
      apiKeys: [
        {key: plainKey, name: 'pre-#72 legacy key', published: true}
      ]
    });

    const result = await runReencryption('true');

    expect(result.apiKeys.migrated).to.equal(1);
    expect(result.apiKeys.failed).to.equal(0);
    const after = await Companies.findOneAsync('zzsec-migrate-noid-co');
    const entry = after.apiKeys[0];
    expect(entry.key.startsWith('v2:')).to.equal(true);
    expect(decrypt(entry.key)).to.equal(plainKey);
    expect(entry.id).to.be.a('string').and.not.empty;
    expect(entry.keyHash).to.equal(hmac(plainKey));
    expect(entry.maskedKey).to.be.a('string');
  });

  it('a MIXED array of id-less and already-id-bearing plaintext entries in the SAME document ' +
    'each get their own distinct backfilled id (no accidental sharing/undefined collision)', async function () {
    const plainNoId = 'a1b2c3d4-noid-1111-1111-111111111111';
    const plainWithId = 'a1b2c3d4-hasid-2222-2222-222222222222';
    await Companies.insertAsync({
      _id: 'zzsec-migrate-mixed-ids-co',
      apiKeys: [
        {key: plainNoId, name: 'no id at all', published: true},
        {id: 'preexisting-id', key: plainWithId, name: 'already has an id, still plaintext', published: true}
      ]
    });

    await runReencryption('true');

    const after = await Companies.findOneAsync('zzsec-migrate-mixed-ids-co');
    const noIdEntry = after.apiKeys.find((k) => decrypt(k.key) === plainNoId);
    const hasIdEntry = after.apiKeys.find((k) => decrypt(k.key) === plainWithId);
    expect(noIdEntry.id).to.be.a('string').and.not.empty;
    expect(hasIdEntry.id).to.equal('preexisting-id');
    expect(noIdEntry.id).to.not.equal(hasIdEntry.id);
  });

  describe('race safety: per-entry guarded writes (Finding 4 fix)', function () {
    afterEach(async function () {
      await Companies.removeAsync({_id: 'zzsec-race-co'});
    });

    it('a concurrent metadata change to a DIFFERENT key in the same company survives the migration write for another key', async function () {
      const plainA = 'race-key-a-1111111111111111';
      const plainB = 'race-key-b-2222222222222222';
      await Companies.insertAsync({
        _id: 'zzsec-race-co',
        apiKeys: [
          {id: 'race-a', key: plainA, name: 'A original', published: true},
          {id: 'race-b', key: plainB, name: 'B original', published: false}
        ]
      });

      // Simulate a concurrent user action (e.g. publishing key B via
      // apiKey.update) landing AFTER the migration's read but BEFORE its
      // per-entry guarded write for key A. With the old whole-array $set,
      // the migration's write for A would overwrite the entire apiKeys
      // array with its stale read and silently revert B's concurrent
      // publish (lost update). With the per-entry guarded write, the
      // migration's write for A only ever touches the ONE array element
      // matched by A's own (unchanged) key value, so it can never
      // clobber B's field.
      const originalUpdateAsync = Companies.updateAsync.bind(Companies);
      let concurrentWriteDone = false;
      const stub = sinon.stub(Companies, 'updateAsync').callsFake(async function (selector, modifier) {
        if (!concurrentWriteDone) {
          concurrentWriteDone = true;
          await originalUpdateAsync(
            {_id: 'zzsec-race-co', 'apiKeys.id': 'race-b'},
            {$set: {'apiKeys.$.published': true}});
        }
        return originalUpdateAsync(selector, modifier);
      });

      try {
        await runReencryption('true');
      } finally {
        stub.restore();
      }

      const after = await Companies.findOneAsync('zzsec-race-co');
      const a = after.apiKeys.find((k) => k.id === 'race-a');
      const b = after.apiKeys.find((k) => k.id === 'race-b');
      expect(a.key.startsWith('v2:'), 'key A must still be migrated').to.equal(true);
      expect(decrypt(a.key)).to.equal(plainA);
      // B is migrated on its own turn moments later (unaffected either way);
      // the point being proven is that A's write never reverted B's
      // concurrent metadata change - which a whole-array $set would have.
      expect(b.key.startsWith('v2:'), 'key B is migrated on its own turn').to.equal(true);
      expect(decrypt(b.key)).to.equal(plainB);
      expect(b.published, 'the concurrent publish of B must survive the migration\'s write for A').to.equal(true);
    });
  });
});

describe('reencrypt-secrets: key rotation (#21)', function () {
  beforeEach(async function () {
    await Companies.removeAsync({});
  });

  afterEach(async function () {
    delete process.env.TS_ENCRYPTION_KEY;
    delete process.env.TS_ENCRYPTION_KEY_PREVIOUS;
    await Companies.removeAsync({});
  });

  it('rewrites values and API keys written with TS_ENCRYPTION_KEY_PREVIOUS', async function () {
    process.env.TS_ENCRYPTION_KEY = 'rotation-spec-old-key';
    const oldToken = encrypt('scanoss-token');
    const oldApiKey = encrypt('rotate-api-key');
    const oldHash = hmac('rotate-api-key');
    await Companies.insertAsync({
      _id: 'zzsec-rotate-co',
      scanoss: {token: oldToken},
      apiKeys: [{id: 'r1', key: oldApiKey, keyHash: oldHash, maskedKey: 'rota...-key', published: true}]
    });
    await Companies.rawCollection().updateOne({_id: 'zzsec-rotate-co'}, {$set: {publicCsafKeys: [
      {id: 'c1', key: encrypt('csaf-feed-key'), keyHash: hmac('csaf-feed-key'), tlpLevels: ['WHITE']}]}});
    process.env.TS_ENCRYPTION_KEY = 'rotation-spec-new-key';
    process.env.TS_ENCRYPTION_KEY_PREVIOUS = 'rotation-spec-old-key';

    const dry = await runReencryption('dry');
    expect(dry.publicKeys.migrated).to.equal(1);
    expect(dry.companies.migrated).to.equal(1);
    expect(dry.apiKeys.migrated).to.equal(1);
    expect((await Companies.findOneAsync('zzsec-rotate-co')).scanoss.token).to.equal(oldToken);

    await runReencryption('true');

    delete process.env.TS_ENCRYPTION_KEY_PREVIOUS;
    const after = await Companies.findOneAsync('zzsec-rotate-co');
    expect(decrypt(after.scanoss.token)).to.equal('scanoss-token');
    expect(decrypt(after.apiKeys[0].key)).to.equal('rotate-api-key');
    expect(after.apiKeys[0].keyHash).to.equal(hmac('rotate-api-key'));
    expect(after.apiKeys[0].keyHash).to.not.equal(oldHash);
    expect(decrypt(after.publicCsafKeys[0].key)).to.equal('csaf-feed-key');
    expect(after.publicCsafKeys[0].keyHash).to.equal(hmac('csaf-feed-key'));
  });
});

describe('reencrypt-secrets: webhooks under the previous key', function () {
  const URL = 'https://hooks.slack.example/services/T000/B000/secret-token';

  beforeEach(async function () {
    await Webhooks.rawCollection().deleteMany({_id: {$in: ['zzsec-wh-old', 'zzsec-wh-current']}});
  });

  afterEach(async function () {
    delete process.env.TS_ENCRYPTION_KEY;
    delete process.env.TS_ENCRYPTION_KEY_PREVIOUS;
    await Webhooks.rawCollection().deleteMany({_id: {$in: ['zzsec-wh-old', 'zzsec-wh-current']}});
  });

  it('rewrites url, header values and secret so they read without the previous key', async function () {
    process.env.TS_ENCRYPTION_KEY = 'webhook-rotation-old-key';
    const old = {url: encrypt(URL), header: encrypt('Bearer header-token'), secret: encrypt('signing-secret-1')};
    process.env.TS_ENCRYPTION_KEY = 'webhook-rotation-new-key';
    process.env.TS_ENCRYPTION_KEY_PREVIOUS = 'webhook-rotation-old-key';
    const current = {_id: 'zzsec-wh-current', url: encrypt('https://current.example/hook'),
      secret: encrypt('signing-secret-2'), headers: [{key: 'X-Token', value: encrypt('current-header')}]};
    await Webhooks.rawCollection().insertMany([
      {_id: 'zzsec-wh-old', url: old.url, secret: old.secret,
        headers: [{key: 'Authorization', value: old.header}]},
      current
    ]);

    const dry = await runReencryption('dry');
    expect(dry.webhooks.migrated).to.equal(3);
    expect((await Webhooks.rawCollection().findOne({_id: 'zzsec-wh-old'})).url).to.equal(old.url);

    const result = await runReencryption('true');
    expect(result.webhooks.migrated).to.equal(3);
    expect(result.webhooks.failed).to.equal(0);

    delete process.env.TS_ENCRYPTION_KEY_PREVIOUS;
    const after = await Webhooks.rawCollection().findOne({_id: 'zzsec-wh-old'});
    expect(decryptV2Only(after.url)).to.equal(URL);
    expect(decryptV2Only(after.headers[0].value)).to.equal('Bearer header-token');
    expect(decryptV2Only(after.secret)).to.equal('signing-secret-1');
    expect(await Webhooks.rawCollection().findOne({_id: 'zzsec-wh-current'})).to.deep.equal(current);
  });
});

describe('reencrypt-secrets: LeanIX token (#46)', function () {
  beforeEach(async function () {
    process.env.TS_ENCRYPTION_KEY = 'leanix-spec-key';
    await Companies.removeAsync({});
  });

  afterEach(async function () {
    delete process.env.TS_ENCRYPTION_KEY;
    await Companies.removeAsync({});
  });

  it('encrypts a LeanIX token stored in plaintext', async function () {
    await Companies.rawCollection().insertOne({_id: 'zzsec-leanix-co', leanix: {companyName: 'acme', token: 'plain-token'}});
    const result = await runReencryption('true');
    expect(result.companiesPlaintext.migrated).to.equal(1);
    const company = await Companies.findOneAsync('zzsec-leanix-co');
    expect(company.leanix.token.startsWith('v2:')).to.equal(true);
    expect(decrypt(company.leanix.token)).to.equal('plain-token');
    expect((await runReencryption('true')).companiesPlaintext.migrated).to.equal(0);
  });
});
