import '/imports/server/collections/companies';   // registers apiKey.logActivity etc.
import RestApi from './RestApi';
import {expect} from 'chai';
import Companies from '/imports/lib/collections/companies';
import {encrypt, hmac} from '/imports/lib/crypto';

// REST auth (getKeyMetaAndCompanyByAccountAndApiKey) looks up by the
// presented key's HMAC hash only, with no plaintext or stored-value fallback -
// covers AC7 (encrypted key still authenticates, lastUsedDate updates), AC8
// (invalid/unpublished/unknown still rejected, unchanged), and legacy
// per-company service keys (externalApiKeys) no longer authenticating.
describe('RestApi.getKeyMetaAndCompanyByAccountAndApiKey (#72)', function () {
  beforeEach(async function () {
    process.env.TS_ENCRYPTION_KEY = 'restapi-spec-test-key';
    await Companies.removeAsync({});
  });

  afterEach(async function () {
    delete process.env.TS_ENCRYPTION_KEY;
    await Companies.removeAsync({});
  });

  it('authenticates via the new hash-based lookup for an encrypted, published key', async function () {
    const plainKey = 'a1b2c3d4-1111-1111-1111-111111111111';
    await Companies.insertAsync({
      _id: 'co-encrypted',
      apiKeys: [{
        id: 'k1',
        key: encrypt(plainKey),
        keyHash: hmac(plainKey),
        maskedKey: 'a1b2...1111',
        name: 'encrypted key',
        published: true,
        scope: ['manager']
      }]
    });

    const result = await RestApi.getKeyMetaAndCompanyByAccountAndApiKey(plainKey);

    expect(result.error).to.be.undefined;
    expect(result.company._id).to.equal('co-encrypted');
    expect(result.keyMeta.id).to.equal('k1');
    expect(result.user.profile.companyId).to.equal('co-encrypted');

    const after = await Companies.findOneAsync('co-encrypted');
    expect(after.apiKeys[0].lastUsedDate).to.exist;
  });

  it('does not authenticate a not-yet-migrated plaintext key (no keyHash)', async function () {
    const plainKey = 'plaintext-legacy-key-2222';
    await Companies.insertAsync({
      _id: 'co-plaintext',
      apiKeys: [{
        id: 'k2',
        key: plainKey,           // no keyHash - pre-migration data
        name: 'plaintext key',
        published: true,
        scope: ['manager']
      }]
    });

    const result = await RestApi.getKeyMetaAndCompanyByAccountAndApiKey(plainKey);

    expect(result.statusCode).to.equal(403);
    expect(result.company).to.be.undefined;
  });

  it('does not accept the stored ciphertext as a key', async function () {
    const plainKey = 'a1b2c3d4-3333-3333-3333-333333333333';
    const stored = encrypt(plainKey);
    await Companies.insertAsync({
      _id: 'co-ciphertext',
      apiKeys: [{
        id: 'k3',
        key: stored,
        keyHash: hmac(plainKey),
        name: 'encrypted key',
        published: true,
        scope: ['manager']
      }]
    });

    const result = await RestApi.getKeyMetaAndCompanyByAccountAndApiKey(stored);

    expect(result.statusCode).to.equal(403);
    expect(result.company).to.be.undefined;
  });

  it('a legacy per-company external key (externalApiKeys.*) does not authenticate', async function () {
    const txValue = 'legacy-psirt-transactions-key-6666';
    const tmValue = 'legacy-threatmodel-transactions-key-7777';
    // Raw insert: externalApiKeys is no longer in the company schema, so a
    // schema-validated insert would strip it before the lookup could be tried.
    await Companies.rawCollection().insertOne({
      _id: 'co-legacy-external',
      externalApiKeys: {
        'psirt-transactions': {id: 'ext-psirt-tx-1', value: encrypt(txValue), valueHash: hmac(txValue)},
        'threatmodel-transactions': {id: 'ext-tm-1', value: tmValue}
      }
    });

    for (const presented of [txValue, tmValue]) {
      const result = await RestApi.getKeyMetaAndCompanyByAccountAndApiKey(presented);
      expect(result.statusCode).to.equal(403);
      expect(result.error).to.equal('Invalid API-key');
      expect(result.company).to.be.undefined;
    }
  });

  it('AC8: rejects an unknown key with 403 (unchanged)', async function () {
    const result = await RestApi.getKeyMetaAndCompanyByAccountAndApiKey('totally-unknown-key');
    expect(result.statusCode).to.equal(403);
    expect(result.error).to.equal('Invalid API-key');
  });

  it('AC8: rejects an unpublished encrypted key with 403 (unchanged)', async function () {
    const plainKey = 'a1b2c3d4-4444-4444-4444-444444444444';
    await Companies.insertAsync({
      _id: 'co-unpublished',
      apiKeys: [{
        id: 'k3',
        key: encrypt(plainKey),
        keyHash: hmac(plainKey),
        name: 'unpublished key',
        published: false
      }]
    });

    const result = await RestApi.getKeyMetaAndCompanyByAccountAndApiKey(plainKey);
    expect(result.statusCode).to.equal(403);
  });

  it('AC8: rejects a missing key with 401 (unchanged)', async function () {
    const result = await RestApi.getKeyMetaAndCompanyByAccountAndApiKey(undefined);
    expect(result.statusCode).to.equal(401);
    expect(result.error).to.equal('API-key missing');
  });

  it('AC8: rejects an operator-injection object instead of a string key', async function () {
    const result = await RestApi.getKeyMetaAndCompanyByAccountAndApiKey({$ne: null});
    expect(result.statusCode).to.equal(401);
  });
});

// A personal access key follows its owner's current membership and roles (#44).
describe('RestApi personal access keys (#44)', function () {
  const {Meteor} = require('meteor/meteor');
  const {Roles} = require('meteor/alanning:roles');
  const sinon = require('sinon');
  const plainKey = 'pak-44-0000-0000-0000-000000000044';
  let ownerId;

  beforeEach(async function () {
    process.env.TS_ENCRYPTION_KEY = 'restapi-spec-test-key';
    await Companies.removeAsync({});
    ownerId = await Meteor.users.insertAsync({
      createdAt: new Date(),
      emails: [{address: 'pak-owner-44@example.com', verified: true}],
      profile: {companyId: 'coPak44', name: 'Owner'}
    });
    await Companies.insertAsync({
      _id: 'coPak44',
      apiKeys: [{id: 'pak1', key: encrypt(plainKey), keyHash: hmac(plainKey), maskedKey: 'pak-...0044',
        name: 'Owner', published: true, scope: ['manager', 'developer'], userId: ownerId}]
    });
  });

  afterEach(async function () {
    sinon.restore();
    delete process.env.TS_ENCRYPTION_KEY;
    await Companies.removeAsync({});
    await Meteor.users.removeAsync(ownerId);
  });

  it('narrows the key to the roles its owner still holds', async function () {
    sinon.stub(Roles, 'getRolesForUserAsync').resolves(['developer']);
    const result = await RestApi.getKeyMetaAndCompanyByAccountAndApiKey(plainKey);
    expect(result.error).to.be.undefined;
    expect(result.keyMeta.scope).to.deep.equal(['developer']);
    // The stored scope is kept for when the roles come back.
    expect((await Companies.findOneAsync('coPak44')).apiKeys[0].scope).to.deep.equal(['manager', 'developer']);
  });

  it('refuses the key when the owner has no role in the company any more', async function () {
    sinon.stub(Roles, 'getRolesForUserAsync').resolves([]);
    const result = await RestApi.getKeyMetaAndCompanyByAccountAndApiKey(plainKey);
    expect(result.statusCode).to.equal(403);
    expect(result.company).to.be.undefined;
  });

  it('refuses the key when the owner is suspended or gone', async function () {
    sinon.stub(Roles, 'getRolesForUserAsync').resolves(['manager']);
    await Meteor.users.rawCollection().updateOne({_id: ownerId}, {$set: {accountStatus: 'suspended'}});
    expect((await RestApi.getKeyMetaAndCompanyByAccountAndApiKey(plainKey)).statusCode).to.equal(403);
    await Meteor.users.removeAsync(ownerId);
    expect((await RestApi.getKeyMetaAndCompanyByAccountAndApiKey(plainKey)).statusCode).to.equal(403);
  });
});

// Public-route keys never reach the request log (#47).
describe('RestApi.maskLogParams (#47)', function () {
  it('masks the named route parameters and credential query parameters', function () {
    const params = Object.assign([], {id: 'release-key', format: 'json',
      query: {apiKey: 'secret', key: 'secret', page: '2'}});
    const masked = RestApi.maskLogParams(params, ['id']);
    expect(masked.id).to.equal('<redacted>');
    expect(masked.format).to.equal('json');
    expect(masked.query).to.deep.equal({apiKey: '<redacted>', key: '<redacted>', page: '2'});
    // The request's own params are left alone.
    expect(params.id).to.equal('release-key');
    expect(params.query.apiKey).to.equal('secret');
  });
});
