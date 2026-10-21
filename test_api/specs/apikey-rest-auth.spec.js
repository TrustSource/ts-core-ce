/* eslint-disable no-undef*/
// REST-auth coverage for the apiKeys[] encryption change.
// Seeds companies directly into Mongo (same technique as releases.spec.js -
// the DDP apiKey.create method requires an authenticated account_admin
// session, which this REST-only harness doesn't have). Seeded values are
// intentionally left PLAINTEXT (no keyHash) here: this exercises the
// TRANSITIONAL DUAL-PATH fallback in RestApi.getKeyMetaAndCompanyByAccountAndApiKey
// against the real running server without needing to know its TS_ENCRYPTION_KEY
// (which this suite has no way to read/match - the encrypted-lookup path is
// covered instead by the in-process imports/server/rest-api/RestApi.spec.js).
const supertest = require('supertest');
const StatusCodes = require('http-status-codes');
const crypto = require('crypto');
const {MongoClient} = require('mongodb');
const ROOT_URL = process.env.ROOT_URL;
const BASE = process.env.BASE;
// Seeds companies straight into the app's database, so it only runs where that database
// is reachable. Gated rather than defaulted to a local port: on CI the default turned
// every test in this suite into a 30s hook timeout naming a beforeAll rather than the
// missing database. See test_api/helpers/gates.js.
const {describeWithMongo, connectMongo} = require('../helpers/gates');

describeWithMongo()(`${BASE}/account/authorization (apikey encryption dual-path, #72)`, () => {
  let mongo;
  const seededCompanyIds = [];

  beforeAll(async () => {
    mongo = await connectMongo(MongoClient);
  });

  afterAll(async () => {
    if (mongo) {
      if (seededCompanyIds.length) {
        await mongo.db().collection('companies').deleteMany({_id: {$in: seededCompanyIds}});
      }
      await mongo.close();
    }
  });

  async function seedCompany(apiKeys, externalApiKeys) {
    const _id = 'zzsec-apikey-' + crypto.randomUUID();
    await mongo.db().collection('companies').insertOne({
      _id, apiKeys, externalApiKeys, billing: {}, created: new Date()
    });
    seededCompanyIds.push(_id);
    return _id;
  }

  it('AC7: a key stored without its hash (not yet migrated) is refused', async () => {
    const plainKey = 'zzsec-plaintext-' + crypto.randomUUID();
    await seedCompany([{id: 'k1', key: plainKey, name: 'plain', published: true}]);

    await supertest(ROOT_URL).get(`${BASE}/account/authorization`)
      .set('x-api-key', plainKey)
      .expect(StatusCodes.FORBIDDEN);
  });

  it('AC8: an unpublished key is rejected with 403 (unchanged)', async () => {
    const plainKey = 'zzsec-unpublished-' + crypto.randomUUID();
    await seedCompany([{id: 'k2', key: plainKey, name: 'unpublished', published: false}]);

    await supertest(ROOT_URL).get(`${BASE}/account/authorization`)
      .set('x-api-key', plainKey)
      .expect(StatusCodes.FORBIDDEN);
  });

  it('AC8: an unknown key is rejected with 403 (unchanged)', async () => {
    await supertest(ROOT_URL).get(`${BASE}/account/authorization`)
      .set('x-api-key', 'zzsec-unknown-' + crypto.randomUUID())
      .expect(StatusCodes.FORBIDDEN);
  });

  it('AC8: a missing key is rejected with 401 (unchanged)', async () => {
    await supertest(ROOT_URL).get(`${BASE}/account/authorization`)
      .expect(StatusCodes.UNAUTHORIZED);
  });

  // Per-company service keys (externalApiKeys) are no longer used; none of them
  // authenticates against this API any more.
  it.each(['psirt-transactions', 'psirt', 'threatmodel-transactions'])(
    'a legacy externalApiKeys.%s value is rejected with 403', async (name) => {
      const plainValue = 'zzsec-legacy-external-' + crypto.randomUUID();
      await seedCompany([], {[name]: {id: 'ext1', value: plainValue}});

      await supertest(ROOT_URL).get(`${BASE}/account/authorization`)
        .set('x-api-key', plainValue)
        .expect(StatusCodes.FORBIDDEN);
    });
});
