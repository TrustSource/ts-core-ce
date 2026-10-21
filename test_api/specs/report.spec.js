/* eslint-disable no-undef*/
const supertest = require('supertest');
const StatusCodes = require('http-status-codes');
const ROOT_URL =  process.env.ROOT_URL;
const BASE =  process.env.BASE;
const API_KEY =  process.env.API_KEY;
const CVE_ID =  process.env.CVE_ID;
const {createProject, removeProjectIfCreated} = require('../helpers/projectFixtures');

// The project the per-project reports read: PROJECT_ID when the environment names one
// (a project with real data), otherwise an empty project this file creates and removes,
// so the suite also runs against a fresh installation.
let projectId = process.env.PROJECT_ID;
let createdProject = null;

beforeAll(async () => {
  if (!projectId) {
    createdProject = await createProject('report-spec-' + Date.now());
    projectId = createdProject.projectId;
  }
});

afterAll(async () => {
  if (createdProject) {
    await removeProjectIfCreated(createdProject.projectId, createdProject.created);
  }
});

describe(`${BASE}/core/reports/vulnerabilities`, () => {
  let url = `${BASE}/core/reports/vulnerabilities`
  it(`403 GET ${url}`, async () => {
    await supertest(ROOT_URL).get(url)
      .expect(StatusCodes.UNAUTHORIZED);
  });
  it(`401 GET ${url}`, async () => {
    await supertest(ROOT_URL).get(url)
      .set('x-api-key', 'SOMEKEY')
      .expect(StatusCodes.FORBIDDEN);
  });
  it(`400 GET ${url}`, async () => {
    await supertest(ROOT_URL).get(url)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.BAD_REQUEST);
  });
  it(`200 GET ${url}`, async () => {
    await supertest(ROOT_URL).get(`${url}?projectId=${projectId}`)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.OK)
      .then((response) => {
        expect(response.body).toHaveProperty('title')
        expect(response.body).toHaveProperty('stats')
        expect(response.body).toHaveProperty('components')
        expect(Array.isArray(response.body.components)).toBeTruthy()
      })
  });
});

describe(`${BASE}/core/reports/versioning`, () => {
  let url = `${BASE}/core/reports/versioning`
  it(`403 GET ${url}`, async () => {
    await supertest(ROOT_URL).get(url)
      .expect(StatusCodes.UNAUTHORIZED);
  });
  it(`401 GET ${url}`, async () => {
    await supertest(ROOT_URL).get(url)
      .set('x-api-key', 'SOMEKEY')
      .expect(StatusCodes.FORBIDDEN);
  });
  it(`400 GET ${url}`, async () => {
    await supertest(ROOT_URL).get(url)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.BAD_REQUEST);
  });
  it(`200 GET ${url}`, async () => {
    await supertest(ROOT_URL).get(`${url}?projectId=${projectId}`)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.OK)
      .then((response) => {
        expect(response.body).toHaveProperty('title')
        expect(response.body).toHaveProperty('stats')
        expect(response.body).toHaveProperty('components')
        expect(Array.isArray(response.body.components)).toBeTruthy()
      })
  });
});

describe(`${BASE}/core/reports/viability`, () => {
  let url = `${BASE}/core/reports/viability`
  it(`403 GET ${url}`, async () => {
    await supertest(ROOT_URL).get(url)
      .expect(StatusCodes.UNAUTHORIZED);
  });
  it(`401 GET ${url}`, async () => {
    await supertest(ROOT_URL).get(url)
      .set('x-api-key', 'SOMEKEY')
      .expect(StatusCodes.FORBIDDEN);
  });
  it(`400 GET ${url}`, async () => {
    await supertest(ROOT_URL).get(url)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.BAD_REQUEST);
  });
  it(`200 GET ${url}`, async () => {
    await supertest(ROOT_URL).get(`${url}?projectId=${projectId}`)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.OK)
      .then((response) => {
        expect(response.body).toHaveProperty('title')
        expect(response.body).toHaveProperty('stats')
        expect(response.body).toHaveProperty('components')
        expect(Array.isArray(response.body.components)).toBeTruthy()
      })
  });
});

describe(`${BASE}/core/reports/licenses`, () => {
  let url = `${BASE}/core/reports/licenses`
  it(`403 GET ${url}`, async () => {
    await supertest(ROOT_URL).get(url)
      .expect(StatusCodes.UNAUTHORIZED);
  });
  it(`401 GET ${url}`, async () => {
    await supertest(ROOT_URL).get(url)
      .set('x-api-key', 'SOMEKEY')
      .expect(StatusCodes.FORBIDDEN);
  });
  it(`400 GET ${url}`, async () => {
    await supertest(ROOT_URL).get(url)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.BAD_REQUEST);
  });
  it(`200 GET ${url}`, async () => {
    await supertest(ROOT_URL).get(`${url}?projectId=${projectId}`)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.OK)
      .then((response) => {
        expect(response.body).toHaveProperty('title')
        expect(response.body).toHaveProperty('stats')
        expect(response.body).toHaveProperty('licenses')
        expect(Array.isArray(response.body.licenses)).toBeTruthy()
      })
  });
});

describe(`${BASE}/core/reports/cve`, () => {
  let url = `${BASE}/core/reports/cve`
  it(`403 GET ${url}`, async () => {
    await supertest(ROOT_URL).get(url)
      .expect(StatusCodes.UNAUTHORIZED);
  });
  it(`401 GET ${url}`, async () => {
    await supertest(ROOT_URL).get(url)
      .set('x-api-key', 'SOMEKEY')
      .expect(StatusCodes.FORBIDDEN);
  });
  it(`400 GET ${url}`, async () => {
    await supertest(ROOT_URL).get(url)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.BAD_REQUEST);
  });
  it(`200 GET ${url}`, async () => {
    await supertest(ROOT_URL).get(`${url}?cveId=${CVE_ID}`)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.OK)
      .then((response) => {
        expect(response.body).toHaveProperty('title')
        expect(response.body).toHaveProperty('projects')
        expect(Array.isArray(response.body.projects)).toBeTruthy()
      })
  });
});

describe(`${BASE}/core/reports/dashboard`, () => {
  let url = `${BASE}/core/reports/dashboard`
  it(`403 GET ${url}`, async () => {
    await supertest(ROOT_URL).get(url)
      .expect(StatusCodes.UNAUTHORIZED);
  });
  it(`401 GET ${url}`, async () => {
    await supertest(ROOT_URL).get(url)
      .set('x-api-key', 'SOMEKEY')
      .expect(StatusCodes.FORBIDDEN);
  });
  it(`200 GET ${url}`, async () => {
    await supertest(ROOT_URL).get(`${url}`)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.OK)
      .then((response) => {
        expect(response.body).toHaveProperty('activityLogs')
        expect(response.body).toHaveProperty('componentsLicenses')
        expect(response.body).toHaveProperty('moduleStats')
        expect(response.body).toHaveProperty('moduleHistory')
        expect(response.body).toHaveProperty('total')
        expect(Array.isArray(response.body.activityLogs)).toBeTruthy()
        expect(Array.isArray(response.body.moduleStats)).toBeTruthy()
        expect(Array.isArray(response.body.moduleHistory)).toBeTruthy()
      })
  });
});
