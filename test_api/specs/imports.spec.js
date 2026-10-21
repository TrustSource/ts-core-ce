/* eslint-disable no-undef, sonarjs/no-duplicate-string*/
const supertest = require('supertest');
const StatusCodes = require('http-status-codes');
const {expectProjectCreatedOrExisting} = require('../helpers/projectFixtures');
const ROOT_URL =  process.env.ROOT_URL;
const BASE =  process.env.BASE;
const API_KEY =  process.env.API_KEY;
const cyclonedxData = require('../response/import_cyclonedx.json');
const cyclonedxUnencodedPurl = require('../response/import_cyclonedx_unencoded_purl.json');
const cyclonedxNoDepsGraph = require('../response/import_cyclonedx_no_deps_graph.json');
const spdxData = require('../response/import_spdx.json');
const {describeWithMongo, connectMongo} = require('../helpers/gates');

const IMPORT_PROJECT = 'TEST_SCAN';

async function waitForModuleAnalysis(moduleId, attempts = 30) {
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

describe(`${BASE}/core/imports/scan/cyclonedx`, () => {
  let url = `${BASE}/core/imports/scan/cyclonedx`

  it(`POST ${BASE}/core/projects [ensure test project]`, async () => {
    await supertest(ROOT_URL).post(`${BASE}/core/projects`)
      .send({name: IMPORT_PROJECT, demo: true})
      .set('x-api-key', API_KEY)
      .expect(expectProjectCreatedOrExisting)
  });

  it(`401 POST ${url}`, async () => {
    await supertest(ROOT_URL).post(url)
      .expect(StatusCodes.UNAUTHORIZED);
  });
  it(`403 POST ${url}`, async () => {
    await supertest(ROOT_URL).post(url)
      .set('x-api-key', 'SOMEKEY')
      .expect(StatusCodes.FORBIDDEN);
  });
  it(`201 POST ${url} [valid CycloneDX]`, async () => {
    await supertest(ROOT_URL).post(url)
      .query({project: IMPORT_PROJECT, module: 'test-cydx', demo: true})
      .send(cyclonedxData)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.CREATED)
      .then((response) => {
        expect(response.body).toHaveProperty('scanId')
      })
  });
  it(`201 POST ${url} [CycloneDX with un-encoded purl versions]`, async () => {
    await supertest(ROOT_URL).post(url)
      .query({project: IMPORT_PROJECT, module: 'test-cydx-purl', demo: true})
      .send(cyclonedxUnencodedPurl)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.CREATED)
      .then((response) => {
        expect(response.body).toHaveProperty('scanId')
      })
  });
  it(`400 POST ${url} [invalid schema]`, async () => {
    await supertest(ROOT_URL).post(url).send({invalid: true})
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.BAD_REQUEST)
  });

  it(`201 POST ${url} [CycloneDX with components but no dependencies graph] - components registered with licenses`, async () => {
    // ensure the import project exists for this account
    await supertest(ROOT_URL).post(`${BASE}/core/projects`)
      .send({name: IMPORT_PROJECT, demo: true})
      .set('x-api-key', API_KEY)
      .expect(expectProjectCreatedOrExisting);

    // unique module name so each test run starts fresh
    const moduleName = `test-cydx-no-deps-graph-${Date.now()}`;

    let moduleId;
    let warning;
    await supertest(ROOT_URL).post(url)
      .query({project: IMPORT_PROJECT, module: moduleName, demo: true})
      .send(cyclonedxNoDepsGraph)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.CREATED)
      .then((response) => {
        expect(response.body).toHaveProperty('scanId');
        expect(response.body).toHaveProperty('moduleId');
        moduleId = response.body.moduleId;
        warning = response.body.warning;
      });

    // Bug signature (pre-fix): converter never runs on flat components, so the raw
    // CycloneDX shape (`licenses[].license.id`, `type`, singular `version`) leaks
    // through schema validation as `keyNotInSchema` warnings.
    if (warning && warning.messages) {
      const offenders = warning.messages.map(m => m.details && m.details.name);
      expect(offenders).not.toContain('licenses.0.license');
      expect(offenders).not.toContain('licenses.0.license.id');
      expect(offenders).not.toContain('type');
    }

    const moduleDoc = await waitForModuleAnalysis(moduleId);
    expect(moduleDoc).not.toBeNull();
    // With the fix the 2 components in the SBOM are registered and at least
    // their MIT/Apache licenses are matched. Pre-fix the dependencies were
    // malformed and dropped, leaving statistics.components at 0.
    expect(moduleDoc.analysis.statistics.components).toBeGreaterThanOrEqual(2);
    expect(moduleDoc.analysis.statistics.licenses).toBeGreaterThanOrEqual(1);
  });

  it(`405 GET ${url}`, async () => {
    await supertest(ROOT_URL).get(url)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.METHOD_NOT_ALLOWED)
  });
});

describe(`${BASE}/core/imports/scan/spdx`, () => {
  let url = `${BASE}/core/imports/scan/spdx`

  it(`401 POST ${url}`, async () => {
    await supertest(ROOT_URL).post(url)
      .expect(StatusCodes.UNAUTHORIZED);
  });
  it(`403 POST ${url}`, async () => {
    await supertest(ROOT_URL).post(url)
      .set('x-api-key', 'SOMEKEY')
      .expect(StatusCodes.FORBIDDEN);
  });
  it(`201 POST ${url} [valid SPDX JSON]`, async () => {
    await supertest(ROOT_URL).post(url)
      .query({project: IMPORT_PROJECT, module: 'test-spdx', demo: true})
      .send(spdxData)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.CREATED)
      .then((response) => {
        expect(response.body).toHaveProperty('scanId')
      })
  });
  it(`400 POST ${url} [invalid schema]`, async () => {
    await supertest(ROOT_URL).post(url).send({invalid: true})
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.BAD_REQUEST)
  });
  it(`405 GET ${url}`, async () => {
    await supertest(ROOT_URL).get(url)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.METHOD_NOT_ALLOWED)
  });
});

// The round trip is the DATABASE half: the POST above is covered several times over, and
// what this adds is that the crypto asset landed module-scoped in cryptoProperties. That
// needs the app's own database, so it only runs where one is reachable - gated rather
// than defaulted to a local port, which on CI just spent the test's whole 30s budget in
// the driver's server-selection timeout. See test_api/helpers/gates.js.
describeWithMongo()(`${BASE}/core/imports/scan/cyclonedx [1.7 + crypto round-trip]`, () => {
  const {MongoClient} = require('mongodb');
  const url = `${BASE}/core/imports/scan/cyclonedx`;
  const assetName = `AES-RT-${Date.now()}`;

  it(`201 POST ${url} [imports a 1.7 CBOM and round-trips the crypto asset]`, async () => {
    const bom = {
      bomFormat: 'CycloneDX', specVersion: '1.7', version: 1,
      metadata: {timestamp: new Date().toISOString()},
      components: [
        {type: 'library', 'bom-ref': 'pkg:npm/rt-app@1.0.0', name: 'rt-app',
          version: '1.0.0', purl: 'pkg:npm/rt-app@1.0.0'},
        {type: 'cryptographic-asset', name: assetName, 'bom-ref': assetName,
          cryptoProperties: {assetType: 'algorithm',
            algorithmProperties: {primitive: 'block-cipher', mode: 'gcm'}}}
      ],
      dependencies: []
    };
    await supertest(ROOT_URL).post(url)
      .query({project: IMPORT_PROJECT, module: `test-cydx-rt-${Date.now()}`, demo: true})
      .send(bom)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.CREATED)
      .then((response) => {
        expect(response.body).toHaveProperty('scanId');
      });

    const client = await connectMongo(MongoClient);
    try {
      const cp = await client.db('meteor').collection('cryptoProperties')
        .findOne({name: assetName});
      expect(cp).toBeTruthy();
      expect(cp.assetType).toBe('algorithm');
      expect(cp.algorithmProperties.primitive).toBe('block-cipher');
      // Imported crypto must be MODULE-scoped (moduleId set, projectId omitted) so it
      // matches CryptoProperties.Find's module-level query and shows in "as managed".
      expect(cp.moduleId).toBeTruthy();
      expect(cp.projectId).toBeUndefined();
    } finally {
      await client.close();
    }
  });
});
