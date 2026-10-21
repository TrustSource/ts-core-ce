/* eslint-disable no-undef*/
const supertest = require('supertest');
const StatusCodes = require('http-status-codes');
const {expectProjectCreatedOrExisting} = require('../helpers/projectFixtures');
const scanData = require('../response/scan_check.json');
const ROOT_URL = process.env.ROOT_URL;
const BASE = process.env.BASE;
const API_KEY = process.env.API_KEY;

describe(`${BASE}/compliance/check/license`, () => {
  let url = `${BASE}/compliance/check/license`

  it(`401 POST ${url}`, async () => {
    await supertest(ROOT_URL).post(url)
      .expect(StatusCodes.UNAUTHORIZED);
  });
  it(`403 POST ${url}`, async () => {
    await supertest(ROOT_URL).post(url)
      .set('x-api-key', 'SOMEKEY')
      .expect(StatusCodes.FORBIDDEN);
  });
});

describe(`${BASE}/compliance/check/component`, () => {
  let url = `${BASE}/compliance/check/component`

  it(`401 POST ${url}`, async () => {
    await supertest(ROOT_URL).post(url)
      .expect(StatusCodes.UNAUTHORIZED);
  });
  it(`403 POST ${url}`, async () => {
    await supertest(ROOT_URL).post(url)
      .set('x-api-key', 'SOMEKEY')
      .expect(StatusCodes.FORBIDDEN);
  });
});

describe(`complex ${BASE}/compliance/check/license & ${BASE}/compliance/check/component`, () => {
  let moduleId;
  /* START Init related data */
  it(`200 POST ${BASE}/core/projects`, async () => {
    const project = {
      name: 'TEST_CHECK',
      demo: true,
      requirements: {
        'CA': 'CA_license',
        'OM': 'OM_SaaS',
        'IP_protect': 'IP_protect_y',
        'IP_enforce': 'IP_enforce_3'
      }
    }
    let projectId;
    await supertest(ROOT_URL).post(`${BASE}/core/projects`).send(project)
      .set('x-api-key', API_KEY)
      .expect(expectProjectCreatedOrExisting)
      .then((response) => {
        expect(response.body).toHaveProperty('projectId')
        projectId = response.body.projectId;
      })

    // The `requirements` above are load-bearing, not decoration: both check endpoints call
    // `project.legalSettingsValid()` on the project this name resolves to, and that returns
    // false without them, which answers 400 "Please complete legal requirements first"
    // instead of the 200 the tests below assert.
    //
    // The create is idempotent, and its existing-name arm returns the
    // project UNMODIFIED - no field of the body above is written to it. So on every run
    // after the first, the requirements simply would not be there. Setting them explicitly
    // through the update route makes the fixture's state a property of this spec rather
    // than of which arm the create happened to take.
    await supertest(ROOT_URL).post(`${BASE}/core/projects/${projectId}`)
      .send({name: project.name, requirements: project.requirements})
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.OK);
  });
  it(`200 POST ${BASE}/core/scans`, async () => {
    await supertest(ROOT_URL).post(`${BASE}/core/scans`).send(scanData)
      .set('user-agent', 'ts-node-client/3.0.1')
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.CREATED)
      .then(async (response) => {
        expect(response.body).toHaveProperty('scanId')
        expect(response.body).toHaveProperty('moduleId')
        moduleId = response.body.moduleId
      })
  });
  it(`200 POST ${BASE}/core/modules/${moduleId}`, async () => {
    // Update module settings
    const module = {
      name: 'TEST_CHECK',
      demo: true,
      'requirements': {
        'TS': 'TS_y',
        'LS': 'LS_os',
        'D': 'D_cslib'
      }
    }
    await supertest(ROOT_URL).post(`${BASE}/core/modules/${moduleId}`).send(module)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.OK)
      .then(async (response) => {
        expect(response.body).toHaveProperty('name')
        expect(response.body.name).toBe(module.name);
      })
  });
  /* END Init related data */
  it(`200 POST ${BASE}/compliance/check/license`, async () => {
    const data = {
      'projectName': 'TEST_CHECK',
      'moduleName': 'TEST_CHECK',
      'licenses': [
        'MIT'
      ]
    }
    await supertest(ROOT_URL).post(`${BASE}/compliance/check/license`).send(data)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.OK)
      .then(async (response) => {
        expect(response.body).toHaveProperty('data')
        expect(response.body.ok).toBe(true);
      })
  });
  it(`200 POST ${BASE}/compliance/check/component`, async () => {
    const data = {
      'projectName': 'TEST_CHECK',
      'moduleName': 'TEST_CHECK',
      'components': [
        {
          key: 'npm:@angular/core',
          version: '4.0.1'
        }
      ]
    }
    // check_component
    await supertest(ROOT_URL).post(`${BASE}/compliance/check/component`).send(data)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.OK)
  });

});
