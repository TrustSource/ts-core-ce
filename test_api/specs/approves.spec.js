/* eslint-disable no-undef*/
const supertest = require('supertest');
const StatusCodes = require('http-status-codes');
const {expectProjectCreatedOrExisting} = require('../helpers/projectFixtures');
const scanData = require('../response/scan_approval.json');
const ROOT_URL =  process.env.ROOT_URL;
const BASE =  process.env.BASE;
const API_KEY =  process.env.API_KEY;

describe(`${BASE}/compliance/approvals`,() => {
  let url = `${BASE}/compliance/approvals`
  let urlGet = `${BASE}/compliance/approvals`
  it(`401 POST ${url}`, async () => {
    await supertest(ROOT_URL).post(url)
      .expect(StatusCodes.UNAUTHORIZED);
  });
  it(`403 POST ${url}`, async () => {
    await supertest(ROOT_URL).post(url)
      .set('x-api-key', 'SOMEKEY')
      .expect(StatusCodes.FORBIDDEN);
  });
  it(`405 DELETE ${url}`, async () => {
    await supertest(ROOT_URL).delete(url)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.METHOD_NOT_ALLOWED)
  });
  it(`405 GET ${url}`, async () => {
    await supertest(ROOT_URL).get(url)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.METHOD_NOT_ALLOWED)
  });

  it(`401 GET ${urlGet}/{approvalId}`, async () => {
    let urlTmp = `${urlGet}/WRONG_ID`
    await supertest(ROOT_URL).get(urlTmp)
      .expect(StatusCodes.UNAUTHORIZED);
  });
  it(`403 GET ${urlGet}/{approvalId}`, async () => {
    let urlTmp = `${urlGet}/WRONG_ID`
    await supertest(ROOT_URL).get(urlTmp)
      .set('x-api-key', 'SOMEKEY')
      .expect(StatusCodes.FORBIDDEN);
  });
  it(`404 GET ${urlGet}/{approvalId}`, async () => {
    let urlTmp = `${urlGet}/WRONG_ID`
    await supertest(ROOT_URL).get(urlTmp)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.NOT_FOUND);
  });
});
describe(`complex 200 POST ${BASE}/compliance/approvals && GET ${BASE}/compliance/approvals`,() => {
  let scanId;
  let approvalId;
  let url = `${BASE}/compliance/approvals`
  it(`200 POST ${BASE}/core/projects`, async () => {
    const data = {
      name: 'TEST_APPROVAL',
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
    // Create new scan to ensure some module available
    await supertest(ROOT_URL).post(`${BASE}/core/scans`).send(scanData)
      .set('user-agent', 'ts-node-client/3.0.1')
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.CREATED)
      .then(async (response) => {
        expect(response.body).toHaveProperty('scanId')
        scanId = response.body.scanId
      });
  });
  it(`200 POST ${url}`, async () => {
    const data = {
      scanId,
      name: 'TEST_APPROVAL',
      version: '1.0.0',
      description: 'TEST_APPROVAL',
      demo: true
    }
    await supertest(ROOT_URL).post(url).send(data)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.CREATED)
      .then(async (response) => {
        expect(response.body).toHaveProperty('approveId')
        approvalId = response.body.approveId
      });
  });
  it(`200 POST ${url}`, async () => {
    const data = {
      name: 'TEST_APPROVAL',
      demo: true
    }
    let urlTmp = `${BASE}/compliance/approvals/${approvalId}`
    await supertest(ROOT_URL).get(urlTmp)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.OK)
      .then(async (response) => {
        expect(response.body).toHaveProperty('name')
        expect(response.body.name).toBe(data.name);
      })
  });
});
