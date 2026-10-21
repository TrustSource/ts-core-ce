//
// Regression: POST /api/v2/core/scans answered 201 but persisted the scan with its
// entire `dependencies` tree removed, so the module ended up with no components
// and never produced an analysis.
//
// Cause: `dependencies` is declared as `{type: [Object], blackbox: true}`. The
// array shorthand expands to `dependencies` + `dependencies.$`, and `blackbox`
// was not carried onto the item definition, so allowsKey() rejected every
// `dependencies.$.<prop>` and SimpleSchema.clean({filter: true}) stripped each
// dependency down to `{}`. Empty objects are then dropped, leaving
// `dependencies: []`, which cleanDoc() removes entirely before the insert.
// The scan still validated (minCount: 0, optional), hence the 201.
//
// The fixture is a real ts-scan payload (npm, 198 nodes over 9 levels, 101
// distinct components). Depth matters: the failure only shows up once the
// filter walks into the array items, so a one-level payload is not enough to
// catch it - which is why the pre-existing scans.spec.js fixture missed it.
//
const supertest = require('supertest');
const StatusCodes = require('http-status-codes');
const {expectProjectCreatedOrExisting} = require('../helpers/projectFixtures');
// A trailing slash on ROOT_URL makes supertest build `//api/v2/...`, which the
// server routes do not match (every request comes back 405), so normalise it.
const ROOT_URL = (process.env.ROOT_URL || '').replace(/\/+$/, '');
const BASE = process.env.BASE;
const API_KEY = process.env.API_KEY;
const nestedScan = require('../response/scan_nested_deps.json');

const SCAN_PROJECT = 'TEST_SCAN';

// Shape of the fixture, asserted below so the expectations stay honest if the
// sample is ever replaced.
const EXPECTED_NODES = 198;
const EXPECTED_UNIQUE_COMPONENTS = 101;

function countNodes(dependencies) {
  return (dependencies || []).reduce((total, dep) => total + 1 + countNodes(dep.dependencies), 0);
}

function collectKeys(dependencies, keys = new Set()) {
  for (const dep of dependencies || []) {
    keys.add(dep.key);
    collectKeys(dep.dependencies, keys);
  }
  return keys;
}

async function waitForModuleAnalysis(moduleId, attempts = 60) {
  for (let i = 0; i < attempts; i++) {
    const resp = await supertest(ROOT_URL).get(`${BASE}/core/modules/${moduleId}`)
      .set('x-api-key', API_KEY);
    if (resp.status === 200 && resp.body && resp.body.analysis && resp.body.analysis.statistics) {
      return resp.body;
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  return null;
}

describe(`${BASE}/core/scans [nested dependency tree]`, () => {
  const moduleName = `nested-deps-mod-${Date.now()}`;
  let scanId;
  let moduleId;

  it('fixture still has the deep tree this test relies on', () => {
    expect(Array.isArray(nestedScan.dependencies)).toBeTruthy();
    expect(countNodes(nestedScan.dependencies)).toBe(EXPECTED_NODES);
    expect(collectKeys(nestedScan.dependencies).size).toBe(EXPECTED_UNIQUE_COMPONENTS);
    // A single root that carries everything below it - the shape ts-scan emits.
    expect(nestedScan.dependencies.length).toBe(1);
    expect(nestedScan.dependencies[0].dependencies.length).toBeGreaterThan(50);
  });

  it(`POST ${BASE}/core/projects [ensure test project]`, async () => {
    await supertest(ROOT_URL).post(`${BASE}/core/projects`)
      .send({name: SCAN_PROJECT, demo: true})
      .set('x-api-key', API_KEY)
      .expect(expectProjectCreatedOrExisting)
  });

  it(`201 POST ${BASE}/core/scans [deep tree accepted]`, async () => {
    const payload = Object.assign({}, nestedScan, {
      project: SCAN_PROJECT,
      module: moduleName,
      moduleId: `npm:${moduleName}`,
      demo: true
    });
    await supertest(ROOT_URL).post(`${BASE}/core/scans`).send(payload)
      .set('user-agent', 'ts-node-client/3.0.1')
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.CREATED)
      .then((response) => {
        expect(response.body).toHaveProperty('scanId');
        expect(response.body).toHaveProperty('moduleId');
        scanId = response.body.scanId;
        moduleId = response.body.moduleId;
      })
  });

  // The actual regression check. Before the fix this module analysed to zero
  // components, because the scan was stored with no dependencies at all.
  it('stores the dependency tree and analyses the components', async () => {
    expect(moduleId).toBeTruthy();
    const moduleDoc = await waitForModuleAnalysis(moduleId);

    expect(moduleDoc).toBeTruthy();
    expect(moduleDoc.analysis.statistics.components).toBe(EXPECTED_UNIQUE_COMPONENTS);
  }, 90000);

  it(`200 GET ${BASE}/core/scans/{scanId} [analysis finished, statistics present]`, async () => {
    expect(scanId).toBeTruthy();
    await supertest(ROOT_URL).get(`${BASE}/core/scans/${scanId}`)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.OK)
      .then((response) => {
        expect(response.body.analysisStatus).toBe('Finished');
        expect(response.body.statistics.components).toBe(EXPECTED_UNIQUE_COMPONENTS);
      })
  });
});
