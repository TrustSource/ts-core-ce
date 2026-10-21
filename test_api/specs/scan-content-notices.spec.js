/* eslint-disable no-undef, sonarjs/no-duplicate-string*/
const supertest = require('supertest');
const StatusCodes = require('http-status-codes');
const {expectProjectCreatedOrExisting} = require('../helpers/projectFixtures');
const ROOT_URL = process.env.ROOT_URL;
const BASE = process.env.BASE;
const API_KEY = process.env.API_KEY;

// Regression tests for contentNotices on scan transfer: validateDependencyLicenses
// is async, so getContentNotices must await it. When it was called without await,
// every scan with dependencies produced bogus "undefined - undefined" notices.
describe(`${BASE}/core/scans contentNotices`, () => {
  let url = `${BASE}/core/scans`;

  function scanPayload(licenses) {
    return {
      project: 'TEST_SCAN_NOTICES',
      module: 'TEST_SCAN_NOTICES',
      moduleId: 'TEST_SCAN_NOTICES',
      demo: true,
      dependencies: [
        {
          name: 'notices-probe',
          key: 'npm:notices-probe',
          private: false,
          licenses: licenses,
          dependencies: [],
          versions: ['1.0.0']
        }
      ]
    };
  }

  it(`200 POST ${BASE}/core/projects [init]`, async () => {
    await supertest(ROOT_URL).post(`${BASE}/core/projects`)
      .send({name: 'TEST_SCAN_NOTICES', demo: true})
      .set('x-api-key', API_KEY)
      .expect(expectProjectCreatedOrExisting)
      .then((response) => {
        expect(response.body).toHaveProperty('projectId');
      });
  });

  it(`201 POST ${url} [known licenses produce no contentNotices]`, async () => {
    await supertest(ROOT_URL).post(url)
      .send(scanPayload([{name: 'MIT'}]))
      .set('user-agent', 'ts-node-client/3.0.1')
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.CREATED)
      .then((response) => {
        expect(response.body).toHaveProperty('scanId');
        expect(response.body).not.toHaveProperty('contentNotices');
      });
  });

  it(`201 POST ${url} [unknown license produces a readable notice]`, async () => {
    await supertest(ROOT_URL).post(url)
      .send(scanPayload([{name: 'NoSuchLicense-TS-Probe'}]))
      .set('user-agent', 'ts-node-client/3.0.1')
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.CREATED)
      .then((response) => {
        expect(response.body).toHaveProperty('scanId');
        expect(response.body).toHaveProperty('contentNotices');
        expect(response.body.contentNotices.types).toEqual({unknownLicense: 1});
        expect(response.body.contentNotices.notices).toEqual([
          {
            message: 'unknownLicense',
            details: 'Dependency: notices-probe - NoSuchLicense-TS-Probe'
          }
        ]);
      });
  });
});
