import { describe, it, before, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createStubDb } from '../helpers/stubDb.js';
import { startFakeOsv, osvRecord } from '../helpers/fakeOsv.js';
import { makeCompany, makeProject, makeModule, makeScan, makeDependency, makeUser, makeComponent } from '../helpers/fixtures.js';
import { Analysis, ModuleAnalyzer } from '../../../analysis/services/ModuleAnalyzer.js';
import { TSCheck } from '../../../analysis/services/TSCheck.js';
import { setSettings } from '../../../analysis/services/Settings.js';

const V31 = 'CVSS:3.1/AV:N/AC:L/PR:H/UI:N/S:U/C:H/I:H/A:H';
let osv;

before(async () => { osv = await startFakeOsv(); });
after(async () => { await osv.close(); setSettings({}); });
beforeEach(() => {
  osv.state.lists.clear();
  osv.state.records.clear();
  osv.state.requests.length = 0;
  // The scan node's purl is what reaches OSV, not the key.
  osv.state.lists.set('pkg:npm/lodash@4.17.20', [{ id: 'GHSA-35jh-r3h4-6jhm', modified: 'M1' }]);
  osv.state.records.set('GHSA-35jh-r3h4-6jhm', osvRecord('GHSA-35jh-r3h4-6jhm',
    { aliases: ['CVE-2021-23337'], vector: V31, label: 'HIGH' }));
});

function prepare() {
  const db = createStubDb({ components: [], infrastructureComponents: [], cves: [], osvVulns: [], manualVulnerabilities: [] });
  const company = makeCompany();
  const project = makeProject();
  const module = makeModule();
  const scan = makeScan([makeDependency('npm:lodash', '4.17.20', { purl: 'pkg:npm/lodash@4.17.20' })]);
  const analysis = new Analysis(company._id, module._id, false, null);
  analysis.gatherComponents(db, scan, module, project, company);
  return { db, company, project, module, analysis };
}

describe('Integration: the analysis looks vulnerabilities up at OSV first', () => {
  it('finds a vulnerability through the cache it just filled', async () => {
    setSettings({ TS_OSV_ENABLED: true, OSV_API_URL: osv.baseUrl });
    const { db, company, project, module, analysis } = prepare();

    await analysis.osvSync(db, module);
    await analysis.vulnerabilityAnalysis(db, module, project, company);

    const problems = analysis.components['npm:lodash'].problems.vulnerability;
    assert.equal(problems.length, 1);
    assert.equal(problems[0].message, 'CVE-2021-23337');
    assert.equal(problems[0].status, 'violations');
    assert.equal(problems[0].version, '4.17.20');
    assert.equal(problems[0].extra.score, 7.2);
    assert.equal(problems[0].extra.link, 'https://nvd.nist.gov/vuln/detail/CVE-2021-23337');
  });

  it('asks OSV nothing when the runner did not switch lookups on', async () => {
    setSettings({ OSV_API_URL: osv.baseUrl });
    const { db, company, project, module, analysis } = prepare();

    await analysis.osvSync(db, module);
    await analysis.vulnerabilityAnalysis(db, module, project, company);

    assert.equal(osv.state.requests.length, 0);
    assert.equal(analysis.components['npm:lodash'].problems, undefined);
  });

  it('has no details step any more', () => {
    assert.equal(Analysis.prototype.vulnerabilityDetails, undefined);
  });
});

// The worker's `cves` shape, seeded straight into the stub db: no OSV round trip.
function cachedPair(entry) {
  return {
    _id: 'osv:seeded', key: 'npm:lodash', source: 'osv',
    versions: [{ version: '4.17.20', checkedAt: new Date(), cves: [Object.assign({ aliases: [], osv_ids: [], cisa: null }, entry)] }]
  };
}

async function analyseWithEnvironment(entry, environmentalConfig) {
  const db = createStubDb({ components: [], infrastructureComponents: [], cves: [cachedPair(entry)], osvVulns: [], manualVulnerabilities: [] });
  const company = makeCompany();
  const project = makeProject();
  const module = makeModule({ environmentalConfig });
  const scan = makeScan([makeDependency('npm:lodash', '4.17.20')]);
  const analysis = new Analysis(company._id, module._id, false, null);
  analysis.gatherComponents(db, scan, module, project, company);
  await analysis.vulnerabilityAnalysis(db, module, project, company);
  return analysis.components['npm:lodash'].problems.vulnerability;
}

describe('Integration: the module environmental vector re-scores findings one by one', () => {
  const V40 = 'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N';

  it('re-scores a CVSS 3 finding from its own vector', async () => {
    const problems = await analyseWithEnvironment({
      vuln_ids: ['CVE-2021-23337'],
      impact: { cvss3: { baseScore: 7.2, vectorString: V31, version: '3.1' } }
    }, { v3vectorString: 'CVSS:3.1/CR:H/IR:H/AR:H/MAV:L' });

    assert.equal(problems.length, 1);
    assert.equal(problems[0].extra.environmental, true);
    assert.equal(problems[0].extra.base, 7.2);
    assert.equal(problems[0].extra.score, 6.7);
  });

  it('keeps a finding whose vector the calculator rejects', async () => {
    const problems = await analyseWithEnvironment({
      vuln_ids: ['CVE-2021-0002'],
      impact: { cvss3: { vectorString: 'CVSS:3.1/AV:Q/AC:L', version: '3.1' } }
    }, { v3vectorString: 'CVSS:3.1/CR:H/IR:H/AR:H/MAV:L' });

    assert.equal(problems.length, 1);
    assert.equal(problems[0].message, 'CVE-2021-0002');
    assert.equal(problems[0].extra.environmental, false);
    assert.equal(problems[0].status, 'warnings');
  });

  it('keeps the base score of a CVSS 4 finding when the module has no CVSS 4 environmental vector', async () => {
    const problems = await analyseWithEnvironment({
      vuln_ids: ['CVE-2021-0003'],
      impact: { cvss4: { baseScore: 9.3, vectorString: V40, version: '4.0' } }
    }, { v3vectorString: 'CVSS:3.1/CR:H/IR:H/AR:H/MAV:L' });

    assert.equal(problems.length, 1);
    assert.equal(problems[0].extra.environmental, false);
    assert.equal(problems[0].extra.score, 9.3);
    assert.equal(problems[0].status, 'violations');
  });
});

describe('Integration: OSV findings count toward the vulnerability status and statistics', () => {
  const V31_MEDIUM = 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:N';

  function osvPair(versionExtra) {
    return {
      _id: 'osv:seeded', key: 'npm:lodash', source: 'osv',
      versions: [Object.assign({ version: '4.17.20', checkedAt: new Date() }, versionExtra, {
        cves: [
          { vuln_ids: ['CVE-2021-23337'], aliases: ['GHSA-35jh-r3h4-6jhm'], osv_ids: ['GHSA-35jh-r3h4-6jhm'],
            impact: { cvss3: { baseScore: 7.2, vectorString: V31, version: '3.1' } }, cisa: null, severity: 'high' },
          { vuln_ids: ['CVE-2020-28500'], aliases: ['GHSA-29mw-wpgm-hmr9'], osv_ids: ['GHSA-29mw-wpgm-hmr9'],
            impact: { cvss3: { baseScore: 5.3, vectorString: V31_MEDIUM, version: '3.1' } }, cisa: null, severity: 'moderate' }
        ]
      })]
    };
  }

  async function analyse(cvesDoc) {
    // No OSV round trip: the cache is seeded, lookups stay off, the legal check is stubbed.
    setSettings({});
    TSCheck.CheckModule = mock.fn(async () => ({ status: 200, data: {} }));
    const db = createStubDb({
      components: [makeComponent('npm:lodash', ['4.17.20'], { declaredLicenses: [{ key: 'MIT', name: 'MIT License' }] })],
      infrastructureComponents: [], cves: [cvesDoc], osvVulns: [], manualVulnerabilities: [], capabilities: [],
      analysis: [], modules: [], logevents: [], companies: [makeCompany()], rules: []
    });
    const scan = makeScan([makeDependency('npm:lodash', '4.17.20')]);
    const analyzer = new ModuleAnalyzer(db, makeCompany(), makeProject(), makeModule(), scan, makeUser(), null, false, 'req-1');
    return analyzer.analyzeModule();
  }

  for (const [label, versionExtra] of [['with confidence 1', { confidence: 1 }], ['written before the confidence field', {}]]) {
    it('rates the component and counts it in the module statistics, ' + label, async () => {
      const result = await analyse(osvPair(versionExtra));

      // By now the analysis holds its components as the list it saves.
      const lodash = result.components.find(component => component.key === 'npm:lodash');
      assert.deepEqual(lodash.problems.vulnerability.map(problem => [problem.message, problem.status]).sort(),
        [['CVE-2020-28500', 'warnings'], ['CVE-2021-23337', 'violations']]);
      assert.equal(lodash.statuses.vulnerability, 'violations');
      assert.deepEqual(result.statistics.vulnerability, { warnings: 0, violations: 1 });
    });
  }
});
