/* eslint-disable no-undef*/
const supertest = require('supertest');
const StatusCodes = require('http-status-codes');
const {expectProjectCreatedOrExisting} = require('../helpers/projectFixtures');
const crypto = require('crypto');
const {MongoClient} = require('mongodb');
const scanData = require('../response/scan_release.json');
const ROOT_URL =  process.env.ROOT_URL;
const BASE =  process.env.BASE;
const API_KEY =  process.env.API_KEY;
const RELEASE_API_KEY =  process.env.RELEASE_API_KEY;
// Only the second block below needs the app's database - it seeds a public release key
// straight into the owning company. Gated rather than defaulted to a local port: on CI
// the default turned all nine of its tests into 30s hook timeouts, while the first block
// (pure REST) passed. See test_api/helpers/gates.js.
const {describeWithMongo, connectMongo} = require('../helpers/gates');

describe(`${BASE}/compliance/releases/:id/actions`,() => {
  let releaseId = RELEASE_API_KEY;
  let url = `${BASE}/compliance/releases/${releaseId}/sbom`
  it(`404 GET ${BASE}/compliance/releases/SOMEID/sbom`, async () => {
    await supertest(ROOT_URL).get(`${BASE}/compliance/releases/SOMEID/sbom`)
      .expect(StatusCodes.NOT_FOUND);
  });
  it(`405 DELETE ${url}`, async () => {
    await supertest(ROOT_URL).delete(url)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.METHOD_NOT_ALLOWED)
  });
  it(`405 GET ${url}`, async () => {
    await supertest(ROOT_URL).post(url)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.METHOD_NOT_ALLOWED)
  });
});

describeWithMongo()(`complex 200 POST /core/scans && POST /compliance/approvals && GET /compliance/releases/{publicReleaseKey}/sbom `,() => {
  let scanId;
  let approvalId;
  // Self-seeded inside the test (see the "seed" step below). The REST approve path
  // cannot mint a public release key - publicReleaseKey.create authorizes via the
  // ambient DDP user (Meteor.userAsync()), which an api-key request does not have, so
  // markDocumentsAsReleased swallows the 403 and no key is created. We therefore insert
  // one directly into the owning company (exactly the shape publicReleaseKey.create +
  // markDocumentsAsReleased produce) and remove it again in afterAll.
  let releaseId;
  let mongo;
  beforeAll(async () => {
    mongo = await connectMongo(MongoClient);
  });
  afterAll(async () => {
    if (mongo) {
      if (releaseId) {
        await mongo.db().collection('companies')
          .updateOne({'publicReleaseKeys.key': releaseId}, {$pull: {publicReleaseKeys: {key: releaseId}}});
      }
      await mongo.close();
    }
  });
  it(`200 POST ${BASE}/core/projects`, async () => {
    const data = {
      name: 'TEST_RELEASE',
      demo: true
    }
    await supertest(ROOT_URL).post(`${BASE}/core/projects`).send(data)
      .set('x-api-key', API_KEY)
      .expect(expectProjectCreatedOrExisting)
      .then((response) => {
        expect(response.body).toHaveProperty('projectId')
      })
  });
  it(`200 POST ${BASE}/core/scans`, async () => {
    await supertest(ROOT_URL).post(`${BASE}/core/scans`).send(scanData)
      .set('user-agent', 'ts-node-client/3.0.1')
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.CREATED)
      .then(async (response) => {
        expect(response.body).toHaveProperty('scanId')
        scanId = response.body.scanId
      })
  });
  it(`200 POST ${BASE}/compliance/approvals`, async () => {
    const data = {
      scanId,
      name: 'TEST_RELEASE',
      version: '1.0.0',
      description: 'TEST_RELEASE',
      demo: true
    }
    // POST
    await supertest(ROOT_URL).post(`${BASE}/compliance/approvals`).send(data)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.CREATED)
      .then(async (response) => {
        approvalId = response.body.approveId
      })
  });
  it(`200 POST ${BASE}/compliance/approvals/{approvalId}/approve`, async () => {
    await supertest(ROOT_URL).post(`${BASE}/compliance/approvals/${approvalId}/approve`)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.OK)
      .then(async (response) => {
        expect(response.body).toHaveProperty('updated')
      })
  });
  it(`seed published public release key for the approval`, async () => {
    // Approve generates the SBOM/notice/VEX documents (keyed by approveId) but not the
    // public key that the /releases/:key endpoints resolve against. Mint it ourselves.
    const company = await mongo.db().collection('approves').findOne({_id: approvalId}, {projection: {companyId: 1}});
    expect(company && company.companyId).toBeTruthy()
    releaseId = crypto.randomUUID();
    const res = await mongo.db().collection('companies').updateOne(
      {_id: company.companyId},
      {$push: {publicReleaseKeys: {
        key: releaseId, releaseId: approvalId, published: true, unpublished: false,
        created: new Date(), requests: []
      }}}
    );
    expect(res.modifiedCount).toBe(1)
  });
  it(`200 GET ${BASE}/compliance/releases/{publicReleaseKey}/sbom`, async () => {
    await supertest(ROOT_URL).get(`${BASE}/compliance/releases/${releaseId}/sbom`)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.OK)
      .then(async (response) => {
        expect(response.body).toHaveProperty('name')
        expect(response.body).toHaveProperty('components')
        expect(Array.isArray(response.body.components)).toBeTruthy()
      })
  });
  it(`200 GET ${BASE}/compliance/releases/{publicReleaseKey}/notice`, async () => {
    await supertest(ROOT_URL).get(`${BASE}/compliance/releases/${releaseId}/notice`)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.OK)
      .then(async (response) => {
        expect(response.body).toHaveProperty('licenses')
        expect(Array.isArray(response.body.licenses)).toBeTruthy()
      })
  });
  it(`200 GET ${BASE}/compliance/releases/{publicReleaseKey}/csaf`, async () => {
    await supertest(ROOT_URL).get(`${BASE}/compliance/releases/${releaseId}/csaf`)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.OK)
      .then(async (response) => {
        expect(response.body).toHaveProperty('document')
        expect(response.body).toHaveProperty('product_tree')
        if(response.body.vulnerabilities){
          expect(Array.isArray(response.body.vulnerabilities)).toBeTruthy()
        }
      })
  });
  it(`200 GET ${BASE}/compliance/releases/{publicReleaseKey}/csaf-changes`, async () => {
    await supertest(ROOT_URL).get(`${BASE}/compliance/releases/${releaseId}/csaf-changes`)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.OK)
      .then(async (response) => {
        expect(response.body).toHaveProperty('document')
        expect(response.body).toHaveProperty('product_tree')
      })
  });
});
