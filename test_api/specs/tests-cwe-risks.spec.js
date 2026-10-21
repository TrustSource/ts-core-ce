/* eslint-disable no-undef*/
const supertest = require('supertest');
const StatusCodes = require('http-status-codes');
const {createProject, removeProjectIfCreated} = require('../helpers/projectFixtures');
const ROOT_URL = process.env.ROOT_URL;
const BASE = process.env.BASE;
const API_KEY = process.env.API_KEY;

// A SARIF import into a project with `autoCreateCweRisks` on keeps
// exactly one risk per (module, tool, CWE) in the risk register, and re-importing
// the same document changes nothing.
//
// End-to-end over the real REST surface, because the guarantees that matter here
// are the ones the pure planner cannot express: the unique partial index, the
// gate chain, and above all AC15 - a byte-identical re-import performing no write
// at all, which is only observable as an unchanged `edited` on a stored document.
//
// This suite needs a live API (the "API test" workflow runs it from master
// against the deployed environment) and is NOT expected to pass locally.
describe(`${BASE}/core/tests/sarif -> CWE risks (#129)`, () => {
  const sarifUrl = `${BASE}/core/tests/sarif`;
  const PROJECT_ON = 'TEST_CWE_RISKS_ON';
  const PROJECT_OFF = 'TEST_CWE_RISKS_OFF';
  const MODULE_ON = 'TEST_CWE_RISKS_MODULE';
  const MODULE_OFF = 'TEST_CWE_RISKS_MODULE_OFF';

  let projectOn;        // {projectId, created} - `created` is what cleanup keys off
  let projectOff;
  let projectOnId;
  let projectOffId;
  let moduleId;
  let createdRiskIds = [];

  // Two rules, three weaknesses: an xss rule tagged CWE-79 and a command-injection
  // rule CodeQL-style tagged with two. Shapes copied from real semgrep/CodeQL
  // documents (see sarif-cwe-extract.unit.spec.js).
  function sarifDoc(includeInjection) {
    const rules = [
      {id: 'javascript.express.security.audit.xss.direct-response-write',
        properties: {cwe: ['CWE-79: Improper Neutralization of Input During Web Page Generation']},
        defaultConfiguration: {level: 'error'}}
    ];
    const results = [
      {ruleId: 'javascript.express.security.audit.xss.direct-response-write', level: 'error',
        message: {text: 'reflected input'},
        locations: [{physicalLocation: {artifactLocation: {uri: 'src/app/render.js'}}}]},
      {ruleId: 'javascript.express.security.audit.xss.direct-response-write', level: 'error',
        message: {text: 'reflected input'},
        locations: [{physicalLocation: {artifactLocation: {uri: 'src/app/reply.js'}}}]}
    ];
    if (includeInjection) {
      rules.push({id: 'py/command-line-injection',
        properties: {tags: ['security', 'external/cwe/cwe-078', 'external/cwe/cwe-088']},
        defaultConfiguration: {level: 'warning'}});
      results.push({ruleId: 'py/command-line-injection', level: 'warning',
        message: {text: 'shell=True'},
        locations: [{physicalLocation: {artifactLocation: {uri: 'tools/deploy.py'}}}]});
    }
    return {version: '2.1.0', runs: [{tool: {driver: {name: 'semgrep', rules}}, results}]};
  }

  function postSarif(projectName, moduleName, doc) {
    return supertest(ROOT_URL)
      .post(`${sarifUrl}?projectName=${projectName}&moduleName=${moduleName}&demo=true`)
      .set('x-api-key', API_KEY)
      .send(doc)
      .expect(StatusCodes.CREATED);
  }

  function getRisks(id) {
    return supertest(ROOT_URL).get(`${BASE}/core/risks?moduleId=${id}`)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.OK);
  }

  function autoRisks(body) {
    return (Array.isArray(body) ? body : [])
      .filter((risk) => risk.riskProperties && risk.riskProperties.autoKey)
      .sort((a, b) => (a.riskProperties.autoCwe < b.riskProperties.autoCwe ? -1 : 1));
  }

  beforeAll(async () => {
    // Neither project is demo data, so nothing resets them between runs and a repeat run
    // legitimately gets 200 + the existing id - see helpers/projectFixtures.
    projectOn = await createProject(PROJECT_ON);
    projectOff = await createProject(PROJECT_OFF);
    projectOnId = projectOn.projectId;
    projectOffId = projectOff.projectId;
    // AC3 - the toggle is settable and readable over REST.
    await supertest(ROOT_URL).post(`${BASE}/core/projects/${projectOnId}`)
      .send({autoCreateCweRisks: true})
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.OK);
    await postSarif(PROJECT_ON, MODULE_ON, sarifDoc(true)).then((response) => {
      moduleId = response.body.moduleId;
    });
  });

  afterAll(async () => {
    // Only the exact rows this spec seeded: risks by id, then the two projects.
    // The demo-flagged test documents and modules are left for Remove demo data in the app.
    for (const riskId of createdRiskIds) {
      await supertest(ROOT_URL).delete(`${BASE}/core/risks/${riskId}?force=true`)
        .set('x-api-key', API_KEY);
    }
    // ?force=true and the status asserted: the SARIF import gave both projects a module,
    // and an unforced delete is refused with 400 - which is how they used to leak.
    for (const project of [projectOn, projectOff]) {
      if (project) { await removeProjectIfCreated(project.projectId, project.created); }
    }
  });

  it('AC6/AC7: one risk per weakness, with the identity and the shape the issue asks for', async () => {
    expect(moduleId).toBeDefined();
    await getRisks(moduleId).then((response) => {
      const risks = autoRisks(response.body);
      createdRiskIds = risks.map((risk) => risk._id);
      // CWE-78 and CWE-88 from the one CodeQL-tagged rule, CWE-79 from the other.
      expect(risks.map((risk) => risk.riskProperties.autoCwe)).toEqual(['CWE-78', 'CWE-79', 'CWE-88']);
      risks.forEach((risk) => {
        const props = risk.riskProperties;
        expect(risk.moduleId).toEqual(moduleId);
        expect(risk.projectId).toEqual(projectOnId);
        expect(props.origin).toEqual(['CWE']);
        expect(props.state).toEqual('identified');
        expect(props.autoTool).toEqual('semgrep');
        expect(props.threatModelContext.cwes).toEqual([props.autoCwe]);
        expect(props.autoKey).toEqual('sarif-cwe|' + moduleId + '|semgrep|' + props.autoCwe);
        expect(risk.name).toEqual('[' + props.autoCwe + '] Weakness reported by Semgrep');
        expect(props.sourceRefsTruncated).toBe(false);
      });
    });
  });

  it('AC10: sourceRefs carry one entry per (rule, file, level) with its count', async () => {
    await getRisks(moduleId).then((response) => {
      const xss = autoRisks(response.body).find((r) => r.riskProperties.autoCwe === 'CWE-79');
      expect(xss.riskProperties.sourceRefsTotal).toEqual(2);
      expect(xss.riskProperties.sourceRefs).toEqual([
        {tool: 'semgrep', ruleId: 'javascript.express.security.audit.xss.direct-response-write',
          uri: 'src/app/render.js', level: 'error', count: 1},
        {tool: 'semgrep', ruleId: 'javascript.express.security.audit.xss.direct-response-write',
          uri: 'src/app/reply.js', level: 'error', count: 1}
      ]);
    });
  });

  it('AC15: a byte-identical re-import writes NOTHING - same ids, untouched edited', async () => {
    let before;
    await getRisks(moduleId).then((response) => {
      before = autoRisks(response.body);
    });
    await postSarif(PROJECT_ON, MODULE_ON, sarifDoc(true));
    await getRisks(moduleId).then((response) => {
      const after = autoRisks(response.body);
      expect(after.length).toEqual(before.length);
      expect(after.map((r) => r._id)).toEqual(before.map((r) => r._id));
      after.forEach((risk, index) => {
        // No write at all, not merely no duplicate row: `edited` is what the
        // update branch would have stamped.
        expect(risk.edited).toEqual(before[index].edited);
        expect(risk.riskProperties.sourceRefs).toEqual(before[index].riskProperties.sourceRefs);
      });
    });
  });

  it('AC24/AC27: a weakness the newer document drops keeps its id and state, loses its evidence', async () => {
    await postSarif(PROJECT_ON, MODULE_ON, sarifDoc(false));
    await getRisks(moduleId).then((response) => {
      const risks = autoRisks(response.body);
      // Still three risks - nothing is deleted, and no state is changed for the user.
      expect(risks.map((r) => r.riskProperties.autoCwe)).toEqual(['CWE-78', 'CWE-79', 'CWE-88']);
      ['CWE-78', 'CWE-88'].forEach((cwe) => {
        const gone = risks.find((r) => r.riskProperties.autoCwe === cwe);
        expect(gone.riskProperties.sourceRefs).toEqual([]);
        expect(gone.riskProperties.sourceRefsTotal).toEqual(0);
        // The N in "0 of N findings still active - ready to close?"
        expect(gone.riskProperties.sourceRefsPrevCount).toEqual(1);
        // Specifically NOT `eliminated`: the importer never moves a state.
        expect(gone.riskProperties.state).toEqual('identified');
      });
      const kept = risks.find((r) => r.riskProperties.autoCwe === 'CWE-79');
      expect(kept.riskProperties.sourceRefs.length).toEqual(2);
      expect(kept.riskProperties.sourceRefsPrevCount).toBeUndefined();
    });
  });

  it('AC1: the same document creates nothing in a project with the toggle off', async () => {
    let offModuleId;
    await postSarif(PROJECT_OFF, MODULE_OFF, sarifDoc(true)).then((response) => {
      offModuleId = response.body.moduleId;
    });
    expect(offModuleId).toBeDefined();
    await getRisks(offModuleId).then((response) => {
      expect(autoRisks(response.body)).toEqual([]);
    });
  });
});
