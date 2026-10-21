import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createStubDb } from '../helpers/stubDb.js';
import { makeCompany, makeProject, makeModule, makeScan, makeDependency, makeUser, makeComponent } from '../helpers/fixtures.js';
import { analyzeWithDb, analysisResultSummary } from '../../../analysis/index.js';
import { ModuleAnalyzer } from '../../../analysis/services/ModuleAnalyzer.js';
import { TSCheck } from '../../../analysis/services/TSCheck.js';

// analyzeWithDb loads what the analyzer needs - the ts-analysis Lambda handler's
// lookups - and answers with the summary ts-app returns and sends with the
// `analysis` webhook.

function seededDb(overrides = {}) {
  return createStubDb({
    users: [makeUser()],
    companies: [makeCompany(), makeCompany({ _id: 'COMPANY_2' })],
    projects: [makeProject()],
    modules: [makeModule()],
    scans: [makeScan([makeDependency('npm:lodash', '4.17.21')], { submitted: new Date('2026-09-01') })],
    components: [makeComponent('npm:lodash', ['4.17.21'])],
    infrastructureComponents: [], cves: [], manualVulnerabilities: [], capabilities: [],
    analysis: [], logevents: [], rules: [],
    ...overrides
  });
}

const INPUT = { companyId: 'COMPANY_1', moduleId: 'MODULE_1', user: makeUser() };

function rejectsWith(code, message) {
  return (error) => {
    assert.equal(error.code, code);
    assert.equal(error.message, message);
    return true;
  };
}

describe('analysis run', () => {
  beforeEach(() => {
    TSCheck.CheckModule = mock.fn(async () => ({ status: 200, data: {} }));
  });

  afterEach(() => {
    mock.restoreAll();
  });

  it('refuses input without companyId and moduleId', async () => {
    await assert.rejects(analyzeWithDb(seededDb(), {}),
      rejectsWith(400, '400 [companyId, moduleId] are required for function execution'));
  });

  it('looks the user up when only userId is given', async () => {
    const result = await analyzeWithDb(seededDb(), { companyId: 'COMPANY_1', moduleId: 'MODULE_1', userId: 'USER_1' });

    assert.ok(result.summary);
  });

  it('answers 404 for an unknown user', async () => {
    await assert.rejects(analyzeWithDb(seededDb(), { companyId: 'COMPANY_1', moduleId: 'MODULE_1', userId: 'NOPE' }),
      rejectsWith(404, '404 User NOPE was not found'));
  });

  it('answers 404 for a module of another company', async () => {
    await assert.rejects(analyzeWithDb(seededDb(), { ...INPUT, companyId: 'COMPANY_2' }),
      rejectsWith(404, '404 Module MODULE_1 was not found'));
  });

  it('answers 404 when the module has no scan', async () => {
    await assert.rejects(analyzeWithDb(seededDb({ scans: [] }), INPUT),
      rejectsWith(404, '404 Scan for module MODULE_1 was not found'));
  });

  it('answers 404 for a scan id the module does not have', async () => {
    await assert.rejects(analyzeWithDb(seededDb(), { ...INPUT, scanId: 'SCAN_X' }),
      rejectsWith(404, '404 Scan SCAN_X was not found'));
  });

  it('analyses the latest scan and answers with the summary and the names', async () => {
    const db = seededDb();

    const result = await analyzeWithDb(db, INPUT);

    const saved = db._collections.analysis[0];
    assert.ok(saved, 'the analysis document is written');
    assert.equal(result.summary._id, saved._id);
    assert.equal(result.summary.moduleId, 'MODULE_1');
    assert.equal(result.summary.scanId, 'SCAN_1');
    assert.equal(result.summary.components, undefined);
    assert.equal(result.projectId, 'PROJECT_1');
    assert.equal(result.projectName, 'Test Project');
    assert.equal(result.moduleName, 'test-module');
  });

  it('uses Unassigned Modules for a module without a project', async () => {
    let seenProject;
    mock.method(ModuleAnalyzer.prototype, 'analyze', async function () {
      seenProject = this.project;
      return { result: { _id: 'a1', moduleId: 'MODULE_1' } };
    });

    const result = await analyzeWithDb(seededDb({ modules: [makeModule({ projectId: undefined })] }), INPUT);

    assert.deepEqual(seenProject, { name: 'Unassigned Modules', _id: '$unassigned' });
    assert.equal(result.projectId, '$unassigned');
    assert.equal(result.projectName, 'Unassigned Modules');
    assert.deepEqual(result.summary, analysisResultSummary({ _id: 'a1', moduleId: 'MODULE_1' }));
  });

  it('throws the error the analyzer ended with', async () => {
    mock.method(ModuleAnalyzer.prototype, 'analyze', async () => new Error('analysis blew up'));

    await assert.rejects(analyzeWithDb(seededDb(), INPUT), /analysis blew up/);
  });
});
