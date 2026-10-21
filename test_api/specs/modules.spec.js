/* eslint-disable no-undef*/
const supertest = require('supertest');
const StatusCodes = require('http-status-codes');
const {expectProjectCreatedOrExisting} = require('../helpers/projectFixtures');
const scanData = require('../response/scan_module.json');
const ROOT_URL =  process.env.ROOT_URL;
const BASE =  process.env.BASE;
const API_KEY =  process.env.API_KEY;

let url = `${BASE}/core/modules`

// A scan's analysis is processed asynchronously (the REST /scans handler defers
// processScan), so poll the partsList endpoint until the analysis has been
// applied and components were extracted, or until timeout. Returns the last
// response body. This separates "analysis not ready yet" from the regression
// where components stay empty even after the analysis completes.
async function pollPartsListComponents(path, attempts = 90) {
  let body;
  for (let i = 0; i < attempts; i++) {
    const response = await supertest(ROOT_URL).get(path)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.OK);
    body = response.body;
    if (body && Array.isArray(body.components) && body.components.length > 0) {
      return body;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return body;
}

describe(`${BASE}/core/modules`,() => {
  let moduleId; // variable to use real module in /{moduleId} methods
  // Create new scan to ensure some module available
  it(`401 GET ${url}`, async () => {
    await supertest(ROOT_URL).get(url)
      .expect(StatusCodes.UNAUTHORIZED);
  });
  it(`403 GET ${url}`, async () => {
    await supertest(ROOT_URL).get(url)
      .set('x-api-key', 'SOMEKEY')
      .expect(StatusCodes.FORBIDDEN);
  });
  it(`405 DELETE ${url}`, async () => {
    await supertest(ROOT_URL).delete(url)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.METHOD_NOT_ALLOWED);
  });
  it(`200 GET ${url}`, async () => {
    await supertest(ROOT_URL).get(url)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.OK)
      .then((response) => {
        expect(Array.isArray(response.body)).toBeTruthy()
        // At least one: this runs before the block below creates its own module, so a
        // fresh company with a single imported module is a valid state here.
        expect(response.body.length).toBeGreaterThan(0)
        expect(response.body[0]).toHaveProperty('_id')
        expect(response.body[0]).toHaveProperty('name')
        expect(response.body[0]).not.toHaveProperty('relatedUsers')
        expect(response.body[0]).not.toHaveProperty('requirements')
      })
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
  it(`404 POST ${url}`, async () => {
    const data = {
      name: 'TEST',
      moduleIdentifier: 'TEST'
    }
    await supertest(ROOT_URL).post(url).send(data)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.NOT_FOUND)
  });

  it(`401 GET ${url}/{moduleId}`, async () => {
    let urlTmp = `${url}/${moduleId}`
    await supertest(ROOT_URL).get(urlTmp)
      .expect(StatusCodes.UNAUTHORIZED);
  });
  it(`403 GET ${url}/{moduleId}`, async () => {
    let urlTmp = `${url}/${moduleId}`
    await supertest(ROOT_URL).get(urlTmp)
      .set('x-api-key', 'SOMEKEY')
      .expect(StatusCodes.FORBIDDEN);
  });
  it(`404 GET ${url}/{moduleId}`, async () => {
    let urlTmp = `${url}/WRONG_ID`
    await supertest(ROOT_URL).get(urlTmp)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.NOT_FOUND);
  });

  it(`401 DELETE ${url}/{moduleId}`, async () => {
    let urlTmp = `${url}/${moduleId}`
    await supertest(ROOT_URL).delete(urlTmp)
      .expect(StatusCodes.UNAUTHORIZED);
  });
  it(`403 DELETE ${url}/{moduleId}`, async () => {
    let urlTmp = `${url}/${moduleId}`
    await supertest(ROOT_URL).delete(urlTmp)
      .set('x-api-key', 'SOMEKEY')
      .expect(StatusCodes.FORBIDDEN);
  });
  it(`404 DELETE ${url}/{moduleId}`, async () => {
    let urlTmp = `${url}/WRONG_ID`
    await supertest(ROOT_URL).delete(urlTmp)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.NOT_FOUND)
  });

  it(`401 POST ${url}/{moduleId}`, async () => {
    let urlTmp = `${url}/${moduleId}`
    await supertest(ROOT_URL).post(urlTmp)
      .expect(StatusCodes.UNAUTHORIZED);
  });
  it(`403 POST ${url}/{moduleId}`, async () => {
    let urlTmp = `${url}/${moduleId}`
    await supertest(ROOT_URL).post(urlTmp)
      .set('x-api-key', 'SOMEKEY')
      .expect(StatusCodes.FORBIDDEN);
  });
  it(`404 POST ${url}/{moduleId}`, async () => {
    let urlTmp = `${url}/WRONG_ID`
    await supertest(ROOT_URL).post(urlTmp)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.NOT_FOUND);
  });
});
describe(`complex GET, POST, DELETE ${url}/{moduleId}`,() => {
  let moduleId; // variable to use real module in /{moduleId} methods
  let projectId; // the scanned module's project, for the project partsList check
  /* START Init related data */
  it(`200 POST ${BASE}/core/projects`, async () => {
    const data = {
      name: 'TEST_SCANMODULE',
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
      .then((response) => {
        expect(response.body).toHaveProperty('moduleId')
        moduleId = response.body.moduleId
      })
  });
  /* END Init related data */
  it(`200 GET ${url}/{moduleId}`, async () => {
    let urlTmp = `${url}/${moduleId}`
    await supertest(ROOT_URL).get(urlTmp)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.OK)
      .then(async (response) => {
        expect(response.body).toHaveProperty('_id')
        expect(response.body).toHaveProperty('name')
        expect(response.body).not.toHaveProperty('relatedUsers')
        projectId = response.body.projectId
      })
  });
  it(`200 POST  ${url}/{moduleId}`, async () => {
    let urlTmp = `${url}/${moduleId}`
    const data = {
      name: 'TEST2'
    }
    await supertest(ROOT_URL).post(urlTmp).send(data)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.OK)
      .then(async (response) => {
        expect(response.body).toHaveProperty('name')
        expect(response.body.name).toBe(data.name);
      })
  });
  // The manual-license-resolution audit trail is NOT writable here.
  //
  // `justification`/`resolvedBy`/`resolvedById`/`resolvedAt` say who determined a
  // component's license and on what written grounds, and only
  // Modules.ResolveComponentLicense (compliance_manager|manager) may write them.
  // Declaring them on SelectedLicensesEntrySchema made them survive clean() on
  // this path, so an integration key carrying the lowest scope in the product
  // could forge the record and steer any component's license past the role gate.
  // The rest of the entry must still round-trip, or the strip has just broken the
  // endpoint instead of hardening it.
  it(`200 POST ${url}/{moduleId} drops a forged license-resolution audit trail`, async () => {
    let urlTmp = `${url}/${moduleId}`
    const forged = {
      componentConfig: {
        licensesSelected: [{
          key: 'npm:left-pad',
          license: 'MIT',
          comment: 'License set manually',
          justification: 'Legal signed off',
          resolvedBy: 'Jane Doe, Head of Legal',
          resolvedById: 'someone-elses-user-id',
          resolvedAt: '2026-09-01T00:00:00.000Z'
        }]
      }
    }
    await supertest(ROOT_URL).post(urlTmp).send(forged)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.OK)
      .then((response) => {
        const stored = response.body.componentConfig.licensesSelected
        expect(stored).toHaveLength(1)
        expect(stored[0]).toEqual({key: 'npm:left-pad', license: 'MIT',
          comment: 'License set manually'})
      })
    await supertest(ROOT_URL).get(urlTmp)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.OK)
      .then((response) => {
        const stored = response.body.componentConfig.licensesSelected
        expect(stored).toHaveLength(1);
        ['justification', 'resolvedBy', 'resolvedById', 'resolvedAt'].forEach((field) => {
          expect(stored[0]).not.toHaveProperty(field)
        })
      })
  });
  // Settings round-trip: POST settings, then GET must return them so API
  // clients can read-modify-write configs (POST replaces configs as a whole).
  it(`200 POST+GET ${url}/{moduleId} settings round-trip`, async () => {
    let urlTmp = `${url}/${moduleId}`
    const settings = {
      licenseConfig: {
        whitelist: [{key: 'MIT', comment: 'approved by legal'}],
        blacklist: [{key: 'AGPL-3.0-only', comment: 'not allowed'}]
      },
      cveConfig: {
        whitelist: [{cveKey: 'CVE-2021-44228', key: 'npm:lodash', version: '1.2.*', comment: 'not exploitable here'}],
        blacklist: []
      },
      viabilityConfig: {enabled: true, warningThreshold: 2, violationThreshold: 1, minConfidence: 2, noInfoLevel: 2},
      requirements: {TS: 'TS_n', LS: 'LS_pl', D: 'D_sslib'}
    }
    await supertest(ROOT_URL).post(urlTmp).send(settings)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.OK)
      .then((response) => {
        expect(response.body.licenseConfig).toEqual(settings.licenseConfig)
        expect(response.body.requirements).toEqual(settings.requirements)
      })
    await supertest(ROOT_URL).get(urlTmp)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.OK)
      .then((response) => {
        expect(response.body.licenseConfig).toEqual(settings.licenseConfig)
        expect(response.body.cveConfig).toEqual(settings.cveConfig)
        expect(response.body.viabilityConfig).toEqual(settings.viabilityConfig)
        expect(response.body.requirements).toEqual(settings.requirements)
        expect(response.body).not.toHaveProperty('relatedUsers')
      })
  });
  // Regression guard (Meteor 3): partsList resolved components via the sync
  // module.getAllComponents(), whose getAnalysis() returns null on the server,
  // so the endpoint returned 0 components even when the analysis had them.
  it(`200 GET ${url}/{moduleId}/partsList returns components`, async () => {
    const body = await pollPartsListComponents(`${url}/${moduleId}/partsList`)
    expect(body).toHaveProperty('components')
    expect(Array.isArray(body.components)).toBeTruthy()
    expect(body.components.length).toBeGreaterThan(0)
    expect(body.components[0]).toHaveProperty('name')
  }, 120000);
  it(`200 GET ${BASE}/core/projects/{projectId}/partsList returns components`, async () => {
    expect(projectId).toBeTruthy()
    const body = await pollPartsListComponents(`${BASE}/core/projects/${projectId}/partsList`)
    expect(body).toHaveProperty('components')
    expect(Array.isArray(body.components)).toBeTruthy()
    expect(body.components.length).toBeGreaterThan(0)
  }, 120000);
  // AIBOM (AI/ML-BOM) + CBOM dedicated endpoints
  it(`401 GET ${url}/{moduleId}/aibom`, async () => {
    await supertest(ROOT_URL).get(`${url}/${moduleId}/aibom`)
      .expect(StatusCodes.UNAUTHORIZED)
  });
  it(`403 GET ${url}/{moduleId}/aibom`, async () => {
    await supertest(ROOT_URL).get(`${url}/${moduleId}/aibom`)
      .set('x-api-key', 'SOMEKEY')
      .expect(StatusCodes.FORBIDDEN)
  });
  it(`200 GET ${url}/{moduleId}/aibom returns CycloneDX`, async () => {
    const response = await supertest(ROOT_URL).get(`${url}/${moduleId}/aibom`)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.OK)
    expect(response.body).toHaveProperty('bomFormat', 'CycloneDX')
    expect(Array.isArray(response.body.components)).toBeTruthy()
  });
  it(`405 POST ${url}/{moduleId}/aibom is not a publish endpoint`, async () => {
    // AIBOM/CBOM are published the same way as the SBOM - by POSTing the CycloneDX
    // document to /imports/scan/cyclonedx (or /scans), not to a dedicated endpoint.
    await supertest(ROOT_URL).post(`${url}/${moduleId}/aibom`)
      .set('x-api-key', API_KEY)
      .send({bomFormat: 'CycloneDX', specVersion: '1.7', components: []})
      .expect(StatusCodes.METHOD_NOT_ALLOWED)
  });
  it(`200 GET ${url}/{moduleId}/cbom returns CycloneDX`, async () => {
    const response = await supertest(ROOT_URL).get(`${url}/${moduleId}/cbom`)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.OK)
    expect(response.body).toHaveProperty('bomFormat', 'CycloneDX')
  });
  it(`200 DELETE ${url}/{moduleId}`, async () => {
    let urlTmp = `${url}/${moduleId}`
    await supertest(ROOT_URL).delete(urlTmp)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.NO_CONTENT)
  });
});
