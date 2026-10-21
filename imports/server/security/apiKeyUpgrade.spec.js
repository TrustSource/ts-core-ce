import {expect} from 'chai';
import Companies from '/imports/lib/collections/companies';
import {decrypt, hmac, maskKey} from '/imports/lib/crypto';
import {needsApiKeyUpgrade, upgradeApiKeyEntry, upgradeApiKeysIfNeeded} from './apiKeyUpgrade';

// Pre-existing apiKeys[]/personal-key entries (created before
// this feature shipped) have no id/keyHash/maskedKey at all - only the
// create path and the opt-in batch migration (TS_REENCRYPT_SECRETS) ever
// populated them. That left the masked-view/copy UX broken for every
// existing key until an operator manually ran the migration. This module is
// the single shared implementation of "upgrade one legacy entry in place",
// reused by both the batch migration (reencrypt-secrets.js) and the
// self-healing on-demand call sites (companyFull, getApiKeysByUser,
// apiKey.reveal in companies.js) so there is exactly one implementation.
describe('apiKeyUpgrade: shared single-entry upgrade helper', function () {
  beforeEach(async function () {
    process.env.TS_ENCRYPTION_KEY = 'apikey-upgrade-spec-test-key';
    await Companies.removeAsync({});
  });

  afterEach(async function () {
    delete process.env.TS_ENCRYPTION_KEY;
    await Companies.removeAsync({});
  });

  describe('needsApiKeyUpgrade()', function () {
    it('is true for a genuinely plaintext (non-v2:) key', function () {
      expect(needsApiKeyUpgrade({key: 'a1b2c3d4-plain-plain-plain-plainplain'})).to.equal(true);
    });

    it('is false for an already-v2:-encrypted key', function () {
      expect(needsApiKeyUpgrade({key: 'v2:whatever'})).to.equal(false);
    });

    it('is false for a falsy/missing entry or key', function () {
      expect(needsApiKeyUpgrade(null)).to.equal(false);
      expect(needsApiKeyUpgrade({})).to.equal(false);
      expect(needsApiKeyUpgrade({key: ''})).to.equal(false);
    });
  });

  describe('upgradeApiKeyEntry()', function () {
    it('encrypts key, backfills keyHash/maskedKey/id, and writes it via a guarded per-field positional update', async function () {
      const plainKey = 'a1b2c3d4-legacy-legacy-legacy-legacy';
      await Companies.insertAsync({
        _id: 'upg-co-1',
        apiKeys: [{key: plainKey, name: 'legacy entry', published: true}]
      });
      const company = await Companies.findOneAsync('upg-co-1');
      const entry = company.apiKeys[0];

      const upgraded = await upgradeApiKeyEntry('upg-co-1', entry);

      expect(upgraded.key.startsWith('v2:')).to.equal(true);
      expect(decrypt(upgraded.key)).to.equal(plainKey);
      expect(upgraded.keyHash).to.equal(hmac(plainKey));
      expect(upgraded.maskedKey).to.equal(maskKey(plainKey));
      expect(upgraded.id).to.be.a('string').and.not.empty;

      // Persisted, not just returned in memory.
      const after = await Companies.findOneAsync('upg-co-1');
      expect(after.apiKeys[0].key).to.equal(upgraded.key);
      expect(after.apiKeys[0].keyHash).to.equal(upgraded.keyHash);
      expect(after.apiKeys[0].maskedKey).to.equal(upgraded.maskedKey);
      expect(after.apiKeys[0].id).to.equal(upgraded.id);
    });

    it('preserves an existing id instead of generating a new one', async function () {
      const plainKey = 'a1b2c3d4-hasid-hasid-hasid-hasid';
      await Companies.insertAsync({
        _id: 'upg-co-2',
        apiKeys: [{id: 'kept-id', key: plainKey, name: 'has id already', published: true}]
      });
      const entry = (await Companies.findOneAsync('upg-co-2')).apiKeys[0];

      const upgraded = await upgradeApiKeyEntry('upg-co-2', entry);

      expect(upgraded.id).to.equal('kept-id');
    });

    it('is a cheap no-op (no write) for an already-migrated (v2:) entry', async function () {
      const alreadyV2 = {
        id: 'already-id', key: 'v2:already-migrated-ciphertext',
        keyHash: 'already-hash', maskedKey: 'alre...dedd', name: 'already migrated', published: true
      };
      await Companies.insertAsync({_id: 'upg-co-3', apiKeys: [alreadyV2]});

      const result = await upgradeApiKeyEntry('upg-co-3', alreadyV2);

      expect(result).to.equal(alreadyV2);   // same reference - genuinely untouched
      const after = await Companies.findOneAsync('upg-co-3');
      expect(after.apiKeys[0]).to.deep.equal(alreadyV2);
    });

    it('race safety: the guarded write only touches the ONE array element matching the plaintext just read, ' +
      'never a concurrently-modified sibling entry', async function () {
      const plainA = 'a1b2c3d4-race-a-race-a-race-a-race';
      const plainB = 'a1b2c3d4-race-b-race-b-race-b-race';
      await Companies.insertAsync({
        _id: 'upg-co-4',
        apiKeys: [
          {id: 'race-a', key: plainA, name: 'A', published: true},
          {id: 'race-b', key: plainB, name: 'B', published: false}
        ]
      });
      const entryA = (await Companies.findOneAsync('upg-co-4')).apiKeys[0];

      // Simulate a concurrent write to B (e.g. a publish) landing between the
      // read and the guarded write for A.
      await Companies.updateAsync({_id: 'upg-co-4', 'apiKeys.id': 'race-b'},
        {$set: {'apiKeys.$.published': true}});

      await upgradeApiKeyEntry('upg-co-4', entryA);

      const after = await Companies.findOneAsync('upg-co-4');
      const b = after.apiKeys.find((k) => k.id === 'race-b');
      expect(b.published, 'B\'s concurrent publish must survive A\'s upgrade write').to.equal(true);
      expect(b.key, 'B must be untouched by A\'s upgrade').to.equal(plainB);
    });
  });

  describe('upgradeApiKeysIfNeeded()', function () {
    it('upgrades every entry that needs it and leaves already-migrated entries byte-identical', async function () {
      const plainOne = 'a1b2c3d4-arr-one-arr-one-arr-one';
      const alreadyV2 = {id: 'v2-id', key: 'v2:untouched', keyHash: 'h', maskedKey: 'm', name: 'v2', published: true};
      await Companies.insertAsync({
        _id: 'upg-co-5',
        apiKeys: [
          {key: plainOne, name: 'legacy', published: true},
          alreadyV2
        ]
      });
      const apiKeys = (await Companies.findOneAsync('upg-co-5')).apiKeys;

      const result = await upgradeApiKeysIfNeeded('upg-co-5', apiKeys);

      const legacyResult = result.find((k) => k.name === 'legacy');
      expect(legacyResult.key.startsWith('v2:')).to.equal(true);
      expect(decrypt(legacyResult.key)).to.equal(plainOne);
      const v2Result = result.find((k) => k.id === 'v2-id');
      // Same reference as the fetched array's own element (untouched by the
      // upgrade) - not the pre-insert `alreadyV2` object, which Mongo
      // deserialization never returns verbatim; deep-equal covers content.
      expect(v2Result).to.equal(apiKeys.find((k) => k.id === 'v2-id'));
      expect(v2Result).to.deep.equal(alreadyV2);
    });

    it('is a total no-op (returns the same array reference) when nothing needs upgrading', async function () {
      const apiKeys = [{id: 'a', key: 'v2:x', keyHash: 'h', maskedKey: 'm', published: true}];
      const result = await upgradeApiKeysIfNeeded('irrelevant', apiKeys);
      expect(result).to.equal(apiKeys);
    });

    it('handles an empty/missing array safely', async function () {
      expect(await upgradeApiKeysIfNeeded('co', [])).to.deep.equal([]);
      expect(await upgradeApiKeysIfNeeded('co', undefined)).to.equal(undefined);
    });
  });
});
