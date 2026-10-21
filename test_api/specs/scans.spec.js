/* eslint-disable no-undef, sonarjs/no-duplicate-string*/
const supertest = require('supertest');
const StatusCodes = require('http-status-codes');
const {createProject, removeProjectIfCreated} = require('../helpers/projectFixtures');
const ROOT_URL =  process.env.ROOT_URL;
const BASE =  process.env.BASE;
const API_KEY =  process.env.API_KEY;
const scanData = require('../response/scan.json');

describe(`${BASE}/core/scans`, () => {
  let scanId; // variable to use real /{scanId} in methods
  let url = `${BASE}/core/scans`

  it(`400 POST ${url} [no user-agent]`, async () => {
    await supertest(ROOT_URL).post(url)
      .expect(StatusCodes.BAD_REQUEST).then((response) => {
        expect(response.body.toString()).toContain('User-Agent header missing');
      });
  });
  it(`401 POST ${url}`, async () => {
    await supertest(ROOT_URL).post(url)
      .set('user-agent', 'ts-node-client/3.0.1')
      .expect(StatusCodes.UNAUTHORIZED);
  });
  it(`403 POST ${url}`, async () => {
    await supertest(ROOT_URL).post(url)
      .set('user-agent', 'ts-node-client/3.0.1')
      .set('x-api-key', 'SOMEKEY')
      .expect(StatusCodes.FORBIDDEN);
  });
  /* START Init related data */
  it(`200/201 POST ${BASE}/core/projects`, async () => {
    // 201 the first time this name is used in the company, 200 + the existing id on every
    // run after that - create is idempotent on {companyId, name}.
    const project = await createProject('TEST_SCAN', {demo: true});
    expect(project.projectId).toBeTruthy();
  });
  /* END Init related data */
  it(`201 POST ${url}`, async () => {
    await supertest(ROOT_URL).post(url).send(scanData)
      .set('user-agent', 'ts-node-client/3.0.1')
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.CREATED)
      .then((response) => {
        expect(response.body).toHaveProperty('scanId')
        scanId = response.body.scanId
      })
  });


  it(`401 GET ${url}`, async () => {
    await supertest(ROOT_URL).get(url)
      .expect(StatusCodes.UNAUTHORIZED);
  });
  it(`403 GET ${url}`, async () => {
    await supertest(ROOT_URL).get(url)
      .set('x-api-key', 'SOMEKEY')
      .expect(StatusCodes.FORBIDDEN);
  });
  it(`200 GET ${url}`, async () => {
    await supertest(ROOT_URL).get(url)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.OK)
      .then((response) => {
        expect(Array.isArray(response.body)).toBeTruthy()
        expect(response.body.length).toBeGreaterThan(1)

        expect(response.body[0]).toHaveProperty('_id')
        expect(response.body[0]).toHaveProperty('module')
        expect(response.body[0]).not.toHaveProperty('dependencies')
      })
  });

  it(`401 GET ${url}/{scanId}`, async () => {
    let urlTmp = `${url}/${scanId}`
    await supertest(ROOT_URL).get(urlTmp)
      .expect(StatusCodes.UNAUTHORIZED);
  });
  it(`403 GET ${url}/{scanId}`, async () => {
    let urlTmp = `${url}/${scanId}`
    await supertest(ROOT_URL).get(urlTmp)
      .set('x-api-key', 'SOMEKEY')
      .expect(StatusCodes.FORBIDDEN);
  });
  it(`404 GET ${url}/{scanId}`, async () => {
    let urlTmp = `${url}/WRONG_ID`
    await supertest(ROOT_URL).get(urlTmp)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.NOT_FOUND);
  });
  it(`200 GET ${url}/{scanId}`, async () => {
    let urlTmp = `${url}/${scanId}`
    await supertest(ROOT_URL).get(urlTmp)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.OK)
      .then(async (response) => {
        expect(response.body).toHaveProperty('_id')
        expect(response.body).toHaveProperty('module')
        expect(response.body).not.toHaveProperty('dependencies')

        await supertest(ROOT_URL).post(`${urlTmp}/reprocess`)
          .set('x-api-key', API_KEY)
          .expect(StatusCodes.CREATED)
          .then((response) => {
            expect(response.body).toHaveProperty('scanId')
            scanId = response.body.scanId
          })
      })
  });
  it(`404 POST ${url}/{scanId}`, async () => {
    let urlTmp = `${url}/${scanId}`
    await supertest(ROOT_URL).post(urlTmp)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.METHOD_NOT_ALLOWED)
  });

  it(`405 DELETE ${url}/{scanId}`, async () => {
    let urlTmp = `${url}/${scanId}`
    await supertest(ROOT_URL).delete(urlTmp)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.METHOD_NOT_ALLOWED)
  });
});

// The mirror of the case covered in tests-sarif.spec.js: the SARIF document
// arrives FIRST and creates the module, then the dependency scan for the same component
// must attach to it instead of creating a second module with the same display name.
// Which upload lands first is order-dependent in a CI matrix, so both directions matter.
describe(`${BASE}/core/scans (module resolution, issue #119)`, () => {
  const PROJECT = 'TEST_SCAN_119_SARIF_FIRST';
  const MODULE = 'moderation-strike-sweeper';
  const scansUrl = `${BASE}/core/scans`;
  let projectId;
  let projectCreated;   // whether THIS run created it
  let sarifModuleId;

  const SARIF_DOC = {
    version: '2.1.0',
    runs: [{
      tool: {driver: {name: 'semgrep', rules: [{id: 'rules.test.error-rule',
        defaultConfiguration: {level: 'error'}}]}},
      results: [{ruleId: 'rules.test.error-rule', level: 'error', message: {text: 'finding one'}}]
    }]
  };

  async function modulesNamed(name) {
    const response = await supertest(ROOT_URL)
      .get(`${BASE}/core/modules?projectId=${projectId}`)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.OK);
    return response.body.filter((m) => m.name === name);
  }

  beforeAll(async () => {
    // This used to assert 201 and take whatever new project it got. When the previous run
    // leaked its project (see afterAll), the create made a SECOND one, the SARIF import
    // resolved the name to the OLDER one, and the module assertions below queried the new
    // one and saw nothing - the reported failure. Both halves are fixed: the create is
    // idempotent, and the cleanup below actually removes the project.
    const project = await createProject(PROJECT, {demo: true});
    projectId = project.projectId;
    projectCreated = project.created;
  });

  afterAll(async () => {
    // ?force=true and the status asserted. Without the flag this delete answered 400 -
    // the project owns a module by now - and nothing checked it, so the project survived
    // into the next run. The demo-flagged module, scan and test document are left for
    // Remove demo data in the app.
    await removeProjectIfCreated(projectId, projectCreated);
  });

  it(`201 POST ${BASE}/core/tests/sarif creates the module`, async () => {
    await supertest(ROOT_URL)
      .post(`${BASE}/core/tests/sarif?projectName=${PROJECT}&moduleName=${MODULE}&demo=true`)
      .set('x-api-key', API_KEY)
      .send(SARIF_DOC)
      .expect(StatusCodes.CREATED)
      .then((response) => {
        sarifModuleId = response.body.moduleId;
      });
    expect((await modulesNamed(MODULE)).length).toEqual(1);
  });

  it(`201 POST ${scansUrl} attaches to the module the SARIF import created`, async () => {
    const scanBody = {
      project: PROJECT,
      module: MODULE,
      moduleId: `npm:${MODULE}`,      // what ts-scan sends: a NAMESPACED identifier
      demo: true,
      dependencies: [{
        name: MODULE,
        key: `npm:${MODULE}`,
        versions: ['1.0.0'],
        licenses: [{name: 'MIT'}]
      }]
    };
    let scanModuleId;
    await supertest(ROOT_URL).post(scansUrl)
      .send(scanBody)
      .set('user-agent', 'ts-node-client/3.0.1')
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.CREATED)
      .then((response) => {
        scanModuleId = response.body.moduleId;
      });

    const modules = await modulesNamed(MODULE);
    expect(modules.length).toEqual(1);
    expect(scanModuleId).toEqual(sarifModuleId);
  });
});
