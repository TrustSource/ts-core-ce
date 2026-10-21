/* eslint-disable no-undef*/
const supertest = require('supertest');
const StatusCodes = require('http-status-codes');
const {createProject, removeProjectIfCreated} = require('../helpers/projectFixtures');
const scanData = require('../response/scan_check.json');
const ROOT_URL =  process.env.ROOT_URL;
const BASE =  process.env.BASE;
const API_KEY =  process.env.API_KEY;

describe(`${BASE}/core/risks`, () => {
  let projectId; // dedicated project so created risks are isolated and cleaned up
  let projectCreated;   // whether THIS run created it - cleanup removes nothing it found
  let moduleId;  // real module attached to projectId (via a scan)
  let otherProjectId;   // a SECOND project, to prove cross-project isolation
  let otherProjectCreated;
  let otherModuleId;    // a module on the second project
  let riskId;        // project-only risk {projectId}
  let bothRiskId;    // both-fields risk {projectId, moduleId} (TM-agent shape)
  let moduleOnlyRiskId; // module-only risk {moduleId}
  let foreignModuleRiskId; // both-fields risk on the OTHER project's module
  let tmaRiskId;     // standalone risk created with origin ['TMA Assessment']
  let legacyOriginRiskId; // standalone risk created with legacy origin ['threat-model']
  let multiOriginRiskId;  // standalone risk created with a multi-value origin array
  let url = `${BASE}/core/risks`

  beforeAll(async () => {
    // 200 (name already present) is as good as 201 here - see helpers/projectFixtures.
    const project = await createProject('TEST_RISKS');
    projectId = project.projectId;
    projectCreated = project.created;
    // attach a real module to the project by posting a scan that references it
    await supertest(ROOT_URL).post(`${BASE}/core/scans`)
      .send({...scanData, project: projectId, module: 'TEST_RISKS_MODULE', moduleId: undefined})
      .set('user-agent', 'ts-node-client/3.0.1')
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.CREATED)
      .then((response) => {
        moduleId = response.body.moduleId
      })
    // second project + module to prove cross-project isolation (criterion 10):
    // a risk on this project's module must NEVER surface under the first project.
    const otherProject = await createProject('TEST_RISKS_OTHER');
    otherProjectId = otherProject.projectId;
    otherProjectCreated = otherProject.created;
    await supertest(ROOT_URL).post(`${BASE}/core/scans`)
      .send({...scanData, project: otherProjectId, module: 'TEST_RISKS_OTHER_MODULE', moduleId: undefined})
      .set('user-agent', 'ts-node-client/3.0.1')
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.CREATED)
      .then((response) => {
        otherModuleId = response.body.moduleId
      })
  });

  afterAll(async () => {
    // clean up only the exact ids created by this spec
    for (const id of [riskId, bothRiskId, moduleOnlyRiskId, foreignModuleRiskId,
      tmaRiskId, legacyOriginRiskId, multiOriginRiskId]) {
      if (id) {
        await supertest(ROOT_URL).delete(`${url}/${id}?force=true`)
          .set('x-api-key', API_KEY)
      }
    }
    // ?force=true, because both projects own a module by now: without it the delete is
    // refused with 400 and the project survives into the next run.
    await removeProjectIfCreated(projectId, projectCreated)
    await removeProjectIfCreated(otherProjectId, otherProjectCreated)
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
  it(`400 GET ${url} without projectId/moduleId returns JSON error object`, async () => {
    await supertest(ROOT_URL).get(url)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.BAD_REQUEST)
      .then((response) => {
        // body must be an object with an error message field - not a bare string
        expect(typeof response.body).toBe('object')
        expect(Array.isArray(response.body)).toBe(false)
        expect(response.body).toHaveProperty('error')
        expect(typeof response.body.error).toBe('string')
      });
  });

  it(`401 POST ${url}`, async () => {
    await supertest(ROOT_URL).post(url)
      .expect(StatusCodes.UNAUTHORIZED);
  });
  it(`201 POST ${url}`, async () => {
    const data = {
      name: 'TEST RISK',
      projectId,
      riskProperties: {
        state: 'identified',
        impactClass: 'high',
        generalApproach: 'mitigate',
        origin: ['CVE'],
        countermeasures: [{
          countermeasure: 'Upgrade to patched version',
          status: 'planned',
          comment: 'baseline countermeasure',
          responsible: []
        }]
      }
    }
    await supertest(ROOT_URL).post(url).send(data)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.CREATED)
      .then((response) => {
        expect(response.body).toHaveProperty('riskId')
        riskId = response.body.riskId
      })
  });

  // --- origin enum is now allowedValues-constrained ---
  // TMA Assessment is the canonical origin for TM-agent risks (criterion 4).
  it(`201 POST ${url} with origin ['TMA Assessment'] then GET-by-id returns it`, async () => {
    const data = {
      name: 'TEST RISK TMA',
      projectId,
      riskProperties: {state: 'identified', origin: ['TMA Assessment'], countermeasures: []}
    }
    await supertest(ROOT_URL).post(url).send(data)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.CREATED)
      .then((response) => {
        expect(response.body).toHaveProperty('riskId')
        tmaRiskId = response.body.riskId
      })
    await supertest(ROOT_URL).get(`${url}/${tmaRiskId}`)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.OK)
      .then((response) => {
        expect(response.body.riskProperties.origin).toContain('TMA Assessment')
      })
  });

  // back-compat: the legacy 'threat-model' value the agent shipped before
  // TMA Assessment must still validate (criterion 9 - no back-compat regression).
  it(`201 POST ${url} with legacy origin ['threat-model'] still accepted`, async () => {
    const data = {
      name: 'TEST RISK LEGACY ORIGIN',
      projectId,
      riskProperties: {state: 'identified', origin: ['threat-model'], countermeasures: []}
    }
    await supertest(ROOT_URL).post(url).send(data)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.CREATED)
      .then((response) => {
        expect(response.body).toHaveProperty('riskId')
        legacyOriginRiskId = response.body.riskId
      })
  });

  // origin is a [String] field with allowedValues applied per-element, so a
  // multi-value array of known origins must validate and round-trip in order
  // (criteria 4, 6 - origin arrays). Mixing a legacy code with TMA Assessment
  // is the realistic shape for a risk surfaced by both a CVE feed and the TM agent.
  it(`201 POST ${url} with multi-value origin ['CVE','TMA Assessment'] round-trips both`, async () => {
    const data = {
      name: 'TEST RISK MULTI ORIGIN',
      projectId,
      riskProperties: {state: 'identified', origin: ['CVE', 'TMA Assessment'], countermeasures: []}
    }
    await supertest(ROOT_URL).post(url).send(data)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.CREATED)
      .then((response) => {
        expect(response.body).toHaveProperty('riskId')
        multiOriginRiskId = response.body.riskId
      })
    await supertest(ROOT_URL).get(`${url}/${multiOriginRiskId}`)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.OK)
      .then((response) => {
        expect(response.body.riskProperties.origin).toEqual(['CVE', 'TMA Assessment'])
      })
  });

  // API validation: a disallowed origin is rejected by RiskSchema.validate()
  // with HTTP 400 (criterion 6). clean() does not strip allowedValues failures,
  // so the bogus member survives to validate() and the create is refused.
  it(`400 POST ${url} rejects an unknown origin`, async () => {
    const data = {
      name: 'TEST RISK BAD ORIGIN',
      projectId,
      riskProperties: {state: 'identified', origin: ['CVE', 'BOGUS'], countermeasures: []}
    }
    await supertest(ROOT_URL).post(url).send(data)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.BAD_REQUEST);
  });

  it(`200 GET ${url}?projectId= contains the project-only risk (broadened)`, async () => {
    await supertest(ROOT_URL).get(`${url}?projectId=${projectId}`)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.OK)
      .then((response) => {
        expect(Array.isArray(response.body)).toBeTruthy()
        // project-only risk is listed under its project
        expect(response.body.map(r => r._id)).toContain(riskId)
      })
  });

  // --- risks carrying a moduleId must appear in list filters ---
  it(`201 POST ${url} both-fields risk (projectId + moduleId)`, async () => {
    const data = {
      name: 'TEST RISK BOTH',
      projectId,
      moduleId,
      riskProperties: {state: 'identified', origin: ['threat-model'], countermeasures: []}
    }
    await supertest(ROOT_URL).post(url).send(data)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.CREATED)
      .then((response) => {
        expect(response.body).toHaveProperty('riskId')
        bothRiskId = response.body.riskId
      })
  });
  it(`200 GET ${url}/{bothRiskId} shows both fields (criterion 1)`, async () => {
    await supertest(ROOT_URL).get(`${url}/${bothRiskId}`)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.OK)
      .then((response) => {
        expect(response.body.projectId).toBe(projectId)
        expect(response.body.moduleId).toBe(moduleId)
      })
  });

  it(`201 POST ${url} module-only risk (moduleId only)`, async () => {
    const data = {
      name: 'TEST RISK MODULE ONLY',
      moduleId,
      riskProperties: {state: 'identified', origin: ['threat-model'], countermeasures: []}
    }
    await supertest(ROOT_URL).post(url).send(data)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.CREATED)
      .then((response) => {
        expect(response.body).toHaveProperty('riskId')
        moduleOnlyRiskId = response.body.riskId
      })
  });

  // CI-only (needs a live app + a second project): a both-fields risk whose
  // moduleId belongs to a DIFFERENT project. It must never leak into
  // ?projectId=<first project> (criterion 10, cross-project isolation).
  it(`201 POST ${url} both-fields risk on a DIFFERENT project's module (cross-project fixture)`, async () => {
    const data = {
      name: 'TEST RISK FOREIGN MODULE',
      projectId: otherProjectId,
      moduleId: otherModuleId,
      riskProperties: {state: 'identified', origin: ['threat-model'], countermeasures: []}
    }
    await supertest(ROOT_URL).post(url).send(data)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.CREATED)
      .then((response) => {
        expect(response.body).toHaveProperty('riskId')
        foreignModuleRiskId = response.body.riskId
      })
  });

  it(`200 GET ${url}?moduleId= contains both-fields and module-only risks (criteria 2, 7)`, async () => {
    await supertest(ROOT_URL).get(`${url}?moduleId=${moduleId}`)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.OK)
      .then((response) => {
        const ids = response.body.map(r => r._id)
        expect(ids).toContain(bothRiskId)       // shape 3 (criterion 2)
        expect(ids).toContain(moduleOnlyRiskId) // shape 2 (criterion 7)
        // project-only risk has no moduleId -> must NOT appear (criterion 6)
        expect(ids).not.toContain(riskId)
        // a risk scoped to a DIFFERENT module must NOT appear (criterion 10)
        expect(ids).not.toContain(foreignModuleRiskId)
        // no _id appears more than once (criterion 5)
        expect(ids.length).toBe(new Set(ids).size)
      })
  });

  it(`200 GET ${url}?projectId= contains all three shapes once, flags module rows (criteria 3,4,5,7,12)`, async () => {
    await supertest(ROOT_URL).get(`${url}?projectId=${projectId}`)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.OK)
      .then((response) => {
        const ids = response.body.map(r => r._id)
        expect(ids).toContain(riskId)            // project-only (criterion 6)
        expect(ids).toContain(bothRiskId)        // both-fields (criterion 3)
        expect(ids).toContain(moduleOnlyRiskId)  // module-only listed under project (criterion 7)
        // a both-fields risk on a DIFFERENT project's module must NOT leak in
        // (its moduleId is not among this project's modules) (criterion 10)
        expect(ids).not.toContain(foreignModuleRiskId)
        // de-dup: no _id twice (criterion 5)
        expect(ids.length).toBe(new Set(ids).size)
        // both-fields row carries moduleItem === true (criterion 4)
        const both = response.body.find(r => r._id === bothRiskId)
        expect(both.moduleItem).toBe(true)
        // no returned risk includes companyId (criterion 12)
        response.body.forEach(r => expect(r).not.toHaveProperty('companyId'))
      })
  });

  // positive control for the cross-project test: the foreign risk DOES appear
  // under its own project - proves the negative assertions above aren't passing
  // because of a broken fixture (criterion 10).
  it(`200 GET ${url}?projectId=otherProject contains its own module risk, not the first project's`, async () => {
    await supertest(ROOT_URL).get(`${url}?projectId=${otherProjectId}`)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.OK)
      .then((response) => {
        const ids = response.body.map(r => r._id)
        expect(ids).toContain(foreignModuleRiskId)   // visible under its real project
        expect(ids).not.toContain(bothRiskId)        // first project's risk not leaked here
        expect(ids).not.toContain(moduleOnlyRiskId)
        expect(ids.length).toBe(new Set(ids).size)   // de-dup (criterion 5)
      })
  });

  it(`200 GET ${url}/{riskId} round-trip`, async () => {
    await supertest(ROOT_URL).get(`${url}/${riskId}`)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.OK)
      .then((response) => {
        expect(response.body.name).toBe('TEST RISK')
        expect(response.body.riskProperties.state).toBe('identified')
        expect(response.body.riskProperties.countermeasures).toHaveLength(1)
        expect(response.body.riskProperties.countermeasures[0].countermeasure).toBe('Upgrade to patched version')
        expect(response.body.riskProperties.countermeasures[0].status).toBe('planned')
        // user attribution comes from the API key's user (apiUser arg), not the request body
        expect(response.body.userId).toBeTruthy()
        expect(response.body.userName).toBeTruthy()
      })
  });
  it(`404 GET ${url}/{riskId}`, async () => {
    await supertest(ROOT_URL).get(`${url}/WRONG_ID`)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.NOT_FOUND);
  });

  it(`200 POST ${url}/{riskId} update state`, async () => {
    await supertest(ROOT_URL).post(`${url}/${riskId}`)
      .send({riskProperties: {state: 'accepted'}})
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.OK)
      .then((response) => {
        expect(response.body.riskProperties.state).toBe('accepted')
        // updates stamp edited/userId/userName from the API key's user
        expect(response.body.edited).toBeTruthy()
        expect(response.body.userId).toBeTruthy()
        expect(response.body.userName).toBeTruthy()
      })
  });

  it(`200 POST ${url}/{riskId} threat-model context + new countermeasure fields round-trip`, async () => {
    const threatModelContext = {
      strideCategories: ['Tampering', 'Elevation of Privilege'],
      enisaCategory: 'Nefarious activity / Abuse',
      enisaThreat: 'Web-application / injection attacks (SQLi, XSS)',
      cwes: ['CWE-89', 'CWE-79'],
      affectedElementType: 'process',
      trustBoundaryCrossing: true,
      tmRunId: 'tm-run-2026-06-04-001',
      tmMethod: 'STRIDE-per-Element',
      otmThreatId: 't-sqli-login'
    }
    const countermeasures = [{
      countermeasure: 'Use parameterised queries for all DB access',
      status: 'required',
      comment: 'Prevents SQL injection',
      responsible: [],
      riskReduction: 90,
      standardRef: 'OWASP-ASVS V5.3.4',
      validationMethod: 'test-suite: tests/security/sqli_test.py',
      otmMitigationId: 'm-prepared-statements'
    }]
    await supertest(ROOT_URL).post(`${url}/${riskId}`)
      .send({riskProperties: {state: 'transferred', threatModelContext, countermeasures}})
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.OK)
      .then((response) => {
        expect(response.body.riskProperties.state).toBe('transferred')
        expect(response.body.riskProperties.threatModelContext).toEqual(threatModelContext)
        // inline countermeasures get a server-assigned _id
        expect(response.body.riskProperties.countermeasures)
          .toEqual([{...countermeasures[0], _id: expect.any(String)}])
      })
    // GET must return the same objects (round-trip via DB, not just the update echo)
    await supertest(ROOT_URL).get(`${url}/${riskId}`)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.OK)
      .then((response) => {
        expect(response.body.riskProperties.threatModelContext).toEqual(threatModelContext)
        expect(response.body.riskProperties.countermeasures)
          .toEqual([{...countermeasures[0], _id: expect.any(String)}])
      })
  });

  it(`400 POST ${url}/{riskId} rejects unknown risk state`, async () => {
    await supertest(ROOT_URL).post(`${url}/${riskId}`)
      .send({riskProperties: {state: 'bogus'}})
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.BAD_REQUEST);
  });

  it(`400 POST ${url}/{riskId} rejects unknown countermeasure status`, async () => {
    await supertest(ROOT_URL).post(`${url}/${riskId}`)
      .send({riskProperties: {countermeasures: [{countermeasure: 'patch the library', status: 'bogus'}]}})
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.BAD_REQUEST);
  });

  it(`400 POST ${url}/{riskId} rejects riskReduction > 100`, async () => {
    await supertest(ROOT_URL).post(`${url}/${riskId}`)
      .send({riskProperties: {countermeasures: [{countermeasure: 'patch the library', riskReduction: 150}]}})
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.BAD_REQUEST);
  });

  let taskId;
  it(`201 POST ${url}/{riskId}/tasks`, async () => {
    const data = {
      task: 'TEST TASK',
      riskId,
      status: 'backlog',
      comment: 'baseline task',
      countermeasure: 'Upgrade to patched version'
    }
    await supertest(ROOT_URL).post(`${url}/${riskId}/tasks`).send(data)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.CREATED)
      .then((response) => {
        expect(response.body).toHaveProperty('taskId')
        expect(response.body.riskId).toBe(riskId)
        taskId = response.body.taskId
      })
  });
  it(`200 GET ${url}/{riskId}/tasks`, async () => {
    await supertest(ROOT_URL).get(`${url}/${riskId}/tasks`)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.OK)
      .then((response) => {
        expect(Array.isArray(response.body)).toBeTruthy()
        expect(response.body.length).toBe(1)
        expect(response.body[0].task).toBe('TEST TASK')
      })
  });
  it(`200 GET ${url}/{riskId}/tasks/{taskId}`, async () => {
    await supertest(ROOT_URL).get(`${url}/${riskId}/tasks/${taskId}`)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.OK)
      .then((response) => {
        expect(response.body.task).toBe('TEST TASK')
        expect(response.body.riskId).toBe(riskId)
      })
  });
  it(`204 DELETE ${url}/{riskId}/tasks/{taskId}`, async () => {
    await supertest(ROOT_URL).delete(`${url}/${riskId}/tasks/${taskId}`)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.NO_CONTENT)
  });

  describe('countermeasures sub-resource', () => {
    let cmId;

    it(`201 POST ${url}/{riskId}/countermeasures`, async () => {
      await supertest(ROOT_URL).post(`${url}/${riskId}/countermeasures`)
        .send({
          countermeasure: 'Enable WAF rule for SQLi',
          status: 'planned',
          comment: 'second line of defense',
          riskReduction: 40,
          standardRef: 'OWASP-ASVS V13.2',
          otmMitigationId: 'm-waf-sqli'
        })
        .set('x-api-key', API_KEY)
        .expect(StatusCodes.CREATED)
        .then((response) => {
          expect(response.body).toHaveProperty('countermeasureId')
          cmId = response.body.countermeasureId
        })
    });

    it(`401 POST ${url}/{riskId}/countermeasures`, async () => {
      await supertest(ROOT_URL).post(`${url}/${riskId}/countermeasures`)
        .send({countermeasure: 'no key'})
        .expect(StatusCodes.UNAUTHORIZED);
    });

    it(`200 GET ${url}/{riskId}/countermeasures lists all with _id`, async () => {
      await supertest(ROOT_URL).get(`${url}/${riskId}/countermeasures`)
        .set('x-api-key', API_KEY)
        .expect(StatusCodes.OK)
        .then((response) => {
          expect(Array.isArray(response.body)).toBeTruthy()
          expect(response.body).toHaveLength(2)
          response.body.forEach((cm) => expect(cm._id).toEqual(expect.any(String)))
        })
    });

    it(`200 GET ${url}/{riskId}/countermeasures/{cmId}`, async () => {
      await supertest(ROOT_URL).get(`${url}/${riskId}/countermeasures/${cmId}`)
        .set('x-api-key', API_KEY)
        .expect(StatusCodes.OK)
        .then((response) => {
          expect(response.body._id).toBe(cmId)
          expect(response.body.countermeasure).toBe('Enable WAF rule for SQLi')
          expect(response.body.riskReduction).toBe(40)
        })
    });

    it(`404 GET ${url}/{riskId}/countermeasures/{cmId} wrong id`, async () => {
      await supertest(ROOT_URL).get(`${url}/${riskId}/countermeasures/WRONG_ID`)
        .set('x-api-key', API_KEY)
        .expect(StatusCodes.NOT_FOUND);
    });

    it(`200 POST ${url}/{riskId}/countermeasures/{cmId} merge-update keeps _id and unsent fields`, async () => {
      await supertest(ROOT_URL).post(`${url}/${riskId}/countermeasures/${cmId}`)
        .send({status: 'verified', _id: 'INJECTED_ID'})
        .set('x-api-key', API_KEY)
        .expect(StatusCodes.OK)
        .then((response) => {
          expect(response.body._id).toBe(cmId)                      // body _id ignored
          expect(response.body.status).toBe('verified')
          expect(response.body.countermeasure).toBe('Enable WAF rule for SQLi')  // unsent field preserved
          expect(response.body.riskReduction).toBe(40)
        })
    });

    it(`404 POST ${url}/{riskId}/countermeasures/{cmId} wrong id`, async () => {
      await supertest(ROOT_URL).post(`${url}/${riskId}/countermeasures/WRONG_ID`)
        .send({status: 'verified'})
        .set('x-api-key', API_KEY)
        .expect(StatusCodes.NOT_FOUND);
    });

    it(`400 POST ${url}/{riskId}/countermeasures rejects bad status`, async () => {
      await supertest(ROOT_URL).post(`${url}/${riskId}/countermeasures`)
        .send({countermeasure: 'valid name here', status: 'bogus'})
        .set('x-api-key', API_KEY)
        .expect(StatusCodes.BAD_REQUEST);
    });

    it(`400 POST ${url}/{riskId}/countermeasures rejects short name`, async () => {
      await supertest(ROOT_URL).post(`${url}/${riskId}/countermeasures`)
        .send({countermeasure: 'ab'})
        .set('x-api-key', API_KEY)
        .expect(StatusCodes.BAD_REQUEST);
    });

    it(`200 POST ${url}/{riskId} partial update preserves countermeasures (no-clobber regression)`, async () => {
      await supertest(ROOT_URL).post(`${url}/${riskId}`)
        .send({riskProperties: {state: 'monitored'}})
        .set('x-api-key', API_KEY)
        .expect(StatusCodes.OK)
        .then((response) => {
          expect(response.body.riskProperties.state).toBe('monitored')
          expect(response.body.riskProperties.countermeasures).toHaveLength(2)
          expect(response.body.riskProperties.threatModelContext).toBeTruthy()
        })
    });

    it(`204 DELETE ${url}/{riskId}/countermeasures/{cmId}`, async () => {
      await supertest(ROOT_URL).delete(`${url}/${riskId}/countermeasures/${cmId}`)
        .set('x-api-key', API_KEY)
        .expect(StatusCodes.NO_CONTENT);
      await supertest(ROOT_URL).get(`${url}/${riskId}/countermeasures`)
        .set('x-api-key', API_KEY)
        .expect(StatusCodes.OK)
        .then((response) => {
          expect(response.body).toHaveLength(1)
        })
    });

    it(`404 DELETE ${url}/{riskId}/countermeasures/{cmId} already removed`, async () => {
      await supertest(ROOT_URL).delete(`${url}/${riskId}/countermeasures/${cmId}`)
        .set('x-api-key', API_KEY)
        .expect(StatusCodes.NOT_FOUND);
    });
  });

  // code-review (criterion 10 - tenant isolation): every selector built in
  // imports/lib/interactors/riskProperties/find.js + listQuery.js carries
  // `companyId` (derived server-side from the DDP user, or the trusted
  // server-call companyId), so a company-A risk can never appear in a
  // company-B list for the same projectId/moduleId. Not exercised here because
  // the suite has a single API key / company.
  //
  // code-review (criterion 11 - pagination): the REST handler computes
  // skip = (page-1)*FETCH_LIMIT with options {limit: FETCH_LIMIT, sort:{created:-1}}
  // and the fix runs a SINGLE $or query, so page=1 returns the first
  // FETCH_LIMIT rows (created desc) and page=2 the next with no overlap.
  // Not exercised here because seeding >100 risks per run is impractical.

  it(`204 DELETE ${url}/{riskId}`, async () => {
    await supertest(ROOT_URL).delete(`${url}/${riskId}?force=true`)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.NO_CONTENT)
    riskId = null
  });
});
