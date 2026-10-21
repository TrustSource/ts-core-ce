/* eslint-disable no-undef*/
const supertest = require('supertest');
const StatusCodes = require('http-status-codes');
const {createProject, removeProjectIfCreated} = require('../helpers/projectFixtures');
const ROOT_URL = process.env.ROOT_URL;
const BASE = process.env.BASE;
const API_KEY = process.env.API_KEY;

// Security agents can list uploaded SARIF documents (origin, date,
// finding counts) and fetch a single document with its full run content.
describe(`${BASE}/core/tests/sarif (read API)`, () => {
  const url = `${BASE}/core/tests/sarif`;
  let projectId;
  let projectCreated;   // whether THIS run created it
  let testId;

  // 2 error findings on one rule, 1 warning finding on another.
  const SARIF_DOC = {
    version: '2.1.0',
    runs: [{
      tool: {
        driver: {
          name: 'semgrep',
          rules: [
            {id: 'rules.test.error-rule', defaultConfiguration: {level: 'error'}},
            {id: 'rules.test.warning-rule', defaultConfiguration: {level: 'warning'}},
            {id: 'rules.test.unused-rule', defaultConfiguration: {level: 'note'}}
          ]
        }
      },
      results: [
        {ruleId: 'rules.test.error-rule', level: 'error', message: {text: 'finding one'}},
        {ruleId: 'rules.test.error-rule', level: 'error', message: {text: 'finding two'}},
        {ruleId: 'rules.test.warning-rule', level: 'warning', message: {text: 'finding three'}}
      ]
    }]
  };

  beforeAll(async () => {
    // Not demo data, so nothing resets it: a repeat run legitimately gets 200 + the
    // existing id rather than a second project - see helpers/projectFixtures.
    const project = await createProject('TEST_SARIF_READ_API');
    projectId = project.projectId;
    projectCreated = project.created;
    // demo=true so Remove demo data in the app can clean the test document up
    await supertest(ROOT_URL)
      .post(`${url}?projectName=TEST_SARIF_READ_API&moduleName=TEST_SARIF_READ_MODULE&demo=true`)
      .set('x-api-key', API_KEY)
      .send(SARIF_DOC)
      .expect(StatusCodes.CREATED)
      .then((response) => {
        testId = response.body.tests && response.body.tests[0];
      });
  });

  afterAll(async () => {
    // Only the exact project created by this run, and only with ?force=true: the SARIF
    // import gave it a module, so an unforced delete is refused with 400 and the project
    // leaks into the next run. The demo-flagged test document and module are
    // left for Remove demo data in the app.
    await removeProjectIfCreated(projectId, projectCreated);
  });

  it(`401 GET list unauthenticated`, async () => {
    await supertest(ROOT_URL).get(url)
      .expect(StatusCodes.UNAUTHORIZED);
  });

  it(`403 GET list with a bad key`, async () => {
    await supertest(ROOT_URL).get(url)
      .set('x-api-key', 'SOMEKEY')
      .expect(StatusCodes.FORBIDDEN);
  });

  it(`200 GET list contains origin, date and finding counts (AC#01)`, async () => {
    await supertest(ROOT_URL).get(url)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.OK)
      .then((response) => {
        expect(Array.isArray(response.body)).toBe(true);
        expect(response.body.length).toBeGreaterThanOrEqual(1);
        const item = response.body.find((t) => t._id === testId);
        expect(item).toBeDefined();
        expect(item.origin).toEqual('semgrep');
        expect(item.type).toEqual('SARIF');
        expect(item.submitted).toBeDefined();
        expect(item.projectName).toEqual('TEST_SARIF_READ_API');
        expect(item.moduleName).toEqual('TEST_SARIF_READ_MODULE');
        // `cwes` asserted, not dropped: it is part of the published shape,
        // and empty is the meaningful answer here - none of the three rules above
        // declares a weakness, and the contract defines an empty array as "the tool told us
        // nothing" rather than "no weaknesses". toEqual keeps this strict, which is what
        // caught the field being added in the first place.
        expect(item.findings).toEqual({total: 3, violations: 2, warnings: 1, notes: 0, cwes: []});
        expect(item.rules).toEqual({total: 3, violations: 1, warnings: 1, notes: 0});
        expect(item.data).toBeUndefined();   // list stays lightweight
      });
  });

  it(`200 GET list filtered by origin`, async () => {
    await supertest(ROOT_URL).get(`${url}?origin=semgrep`)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.OK)
      .then((response) => {
        expect(response.body.some((t) => t._id === testId)).toBe(true);
      });
    await supertest(ROOT_URL).get(`${url}?origin=NO_SUCH_TOOL`)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.OK)
      .then((response) => {
        expect(response.body.length).toEqual(0);
      });
  });

  it(`200 GET list filtered by projectName and moduleName`, async () => {
    await supertest(ROOT_URL)
      .get(`${url}?projectName=TEST_SARIF_READ_API&moduleName=TEST_SARIF_READ_MODULE`)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.OK)
      .then((response) => {
        expect(response.body.length).toBeGreaterThanOrEqual(1);
        expect(response.body.every((t) => t.projectName === 'TEST_SARIF_READ_API')).toBe(true);
      });
  });

  it(`401 GET document unauthenticated`, async () => {
    await supertest(ROOT_URL).get(`${url}/${testId}`)
      .expect(StatusCodes.UNAUTHORIZED);
  });

  it(`200 GET document returns the full SARIF run (AC#02)`, async () => {
    await supertest(ROOT_URL).get(`${url}/${testId}`)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.OK)
      .then((response) => {
        const doc = response.body;
        expect(doc._id).toEqual(testId);
        expect(doc.origin).toEqual('semgrep');
        expect(doc.findings.total).toEqual(3);
        expect(doc.sarif).toBeDefined();
        expect(doc.sarif.version).toEqual('2.1.0');
        expect(doc.sarif.runs.length).toEqual(1);
        const run = doc.sarif.runs[0];
        expect(run.tool.driver.name).toEqual('semgrep');
        expect(run.results.length).toEqual(3);
        expect(run.results[0].message.text).toEqual('finding one');
      });
  });

  it(`404 GET document with an unknown id`, async () => {
    await supertest(ROOT_URL).get(`${url}/NONEXISTENT`)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.NOT_FOUND);
  });

  it(`405 PUT on a document`, async () => {
    await supertest(ROOT_URL).put(`${url}/${testId}`)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.METHOD_NOT_ALLOWED);
  });
});

// A dependency scan and a SARIF document for the same component must land
// on ONE module. The scan derives its identifier from `moduleId` (`npm:<name>`), the SARIF
// import derives it from the name (`<name>`), so an identifier-only match used to miss and
// create a second module with the same display name.
describe(`${BASE}/core/tests/sarif (module resolution, issue #119)`, () => {
  const PROJECT = 'TEST_SARIF_119_SCAN_FIRST';
  const MODULE = 'admin-panel';
  const url = `${BASE}/core/tests/sarif`;
  let projectId;
  let projectCreated;   // whether THIS run created it

  const SARIF_DOC = {
    version: '2.1.0',
    runs: [{
      tool: {driver: {name: 'semgrep', rules: [{id: 'rules.test.error-rule',
        defaultConfiguration: {level: 'error'}}]}},
      results: [{ruleId: 'rules.test.error-rule', level: 'error', message: {text: 'finding one'}}]
    }]
  };

  function scanBody() {
    return {
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
  }

  async function modulesNamed(name) {
    const response = await supertest(ROOT_URL)
      .get(`${BASE}/core/modules?projectId=${projectId}`)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.OK);
    return response.body.filter((m) => m.name === name);
  }

  beforeAll(async () => {
    const project = await createProject(PROJECT, {demo: true});
    projectId = project.projectId;
    projectCreated = project.created;
  });

  afterAll(async () => {
    // Only the project this run created, forced (it owns a module by now) and with the
    // status asserted - an unforced delete answers 400 and leaks it. Its
    // demo-flagged module, scan and test document are left for Remove demo data in the app.
    await removeProjectIfCreated(projectId, projectCreated);
  });

  it(`201 POST ${BASE}/core/scans creates the module`, async () => {
    await supertest(ROOT_URL).post(`${BASE}/core/scans`)
      .send(scanBody())
      .set('user-agent', 'ts-node-client/3.0.1')
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.CREATED);
    expect((await modulesNamed(MODULE)).length).toEqual(1);
  });

  it(`201 POST ${url} attaches to the module the scan created`, async () => {
    let sarifModuleId;
    await supertest(ROOT_URL)
      .post(`${url}?projectName=${PROJECT}&moduleName=${MODULE}&demo=true`)
      .set('x-api-key', API_KEY)
      .send(SARIF_DOC)
      .expect(StatusCodes.CREATED)
      .then((response) => {
        sarifModuleId = response.body.moduleId;
      });

    const modules = await modulesNamed(MODULE);
    expect(modules.length).toEqual(1);
    expect(sarifModuleId).toEqual(modules[0]._id);
  });
});

// A cleanly completed scan with zero findings was stored as "Unfinished",
// because the presence of `invocations` (which every complete SARIF run carries) was read
// as "not finished yet". Completion comes from `invocations[].executionSuccessful`.
describe(`${BASE}/core/tests/sarif (run status, issue #123)`, () => {
  const PROJECT = 'TEST_SARIF_123_STATUS';
  const url = `${BASE}/core/tests/sarif`;
  let projectId;
  let projectCreated;   // whether THIS run created it

  // A `semgrep scan --config auto --sarif` run that found nothing: the driver still
  // declares its whole loaded rule catalog, and the invocation reports success.
  function cleanRun(executionSuccessful) {
    return {
      version: '2.1.0',
      runs: [{
        tool: {driver: {name: 'Semgrep OSS', rules: [
          {id: 'rules.test.catalog-a', defaultConfiguration: {level: 'error'}},
          {id: 'rules.test.catalog-b', defaultConfiguration: {level: 'warning'}},
          {id: 'rules.test.catalog-c', defaultConfiguration: {level: 'note'}}
        ]}},
        results: [],
        invocations: [{executionSuccessful, toolExecutionNotifications: []}]
      }]
    };
  }

  async function upload(doc, moduleName) {
    const response = await supertest(ROOT_URL)
      .post(`${url}?projectName=${PROJECT}&moduleName=${moduleName}&demo=true`)
      .set('x-api-key', API_KEY)
      .send(doc)
      .expect(StatusCodes.CREATED);
    return response.body.tests && response.body.tests[0];
  }

  async function fetchDoc(id) {
    const response = await supertest(ROOT_URL).get(`${url}/${id}`)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.OK);
    return response.body;
  }

  beforeAll(async () => {
    const project = await createProject(PROJECT, {demo: true});
    projectId = project.projectId;
    projectCreated = project.created;
  });

  afterAll(async () => {
    // Only the project this run created, forced (it owns a module by now) and with the
    // status asserted - an unforced delete answers 400 and leaks it. Its
    // demo-flagged modules and test documents are left for Remove demo data in the app.
    await removeProjectIfCreated(projectId, projectCreated);
  });

  it(`a completed scan with no findings is PASSED, not UNFINISHED`, async () => {
    const doc = await fetchDoc(await upload(cleanRun(true), 'TEST_SARIF_123_CLEAN'));
    expect(doc.status).toEqual('PASSED');
    expect(doc.findings).toEqual({total: 0, violations: 0, warnings: 0, notes: 0, cwes: []});
    // `rules.total` stays the tool's declared catalog - the UI labels it as such,
    // because SARIF carries no count of the rules actually applied.
    expect(doc.rules.total).toEqual(3);
  });

  it(`a scan the tool reports as unsuccessful is FAILED`, async () => {
    const doc = await fetchDoc(await upload(cleanRun(false), 'TEST_SARIF_123_ABORTED'));
    expect(doc.status).toEqual('FAILED');
    expect(doc.findings.total).toEqual(0);
  });

  it(`a completed scan WITH findings is FAILED and counts them`, async () => {
    const withFindings = cleanRun(true);
    withFindings.runs[0].results = [
      {ruleIndex: 0, message: {text: 'first-rule finding, index 0'}},
      {ruleId: 'rules.test.catalog-b', level: 'warning', message: {text: 'a warning'}}
    ];
    const doc = await fetchDoc(await upload(withFindings, 'TEST_SARIF_123_FINDINGS'));
    expect(doc.status).toEqual('FAILED');
    // ruleIndex 0 used to be read as "no index" and the finding was dropped entirely.
    expect(doc.findings).toEqual({total: 2, violations: 1, warnings: 1, notes: 0, cwes: []});
    expect(doc.rules).toEqual({total: 3, violations: 1, warnings: 1, notes: 0});
  });
});
