import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createStubDb } from '../helpers/stubDb.js';
import { makeCompany, makeProject, makeModule, makeScan, makeDependency, makeUser, makeComponent } from '../helpers/fixtures.js';
import { Analysis, ModuleAnalyzer } from '../../../analysis/services/ModuleAnalyzer.js';
import { TSCheck } from '../../../analysis/services/TSCheck.js';
import { Utils } from '../../../analysis/services/Utils.js';

// Mock TSCheck to avoid HTTP calls
function mockTSCheck() {
  const checkModuleMock = mock.fn(async () => ({
    status: 200,
    data: {}
  }));
  TSCheck.CheckModule = checkModuleMock;
  return { checkModuleMock };
}

// A stand-in for the external legal check that BEHAVES like the real one instead of
// rubber-stamping: it captures the request Utils.rebuildModuleObject produced, and
// answers only for the component:version:path keys that request actually named a
// license for. A component sent with an empty license list gets no answer back -
// which is exactly what makes evaluateLicenses fall back to the "unknown /
// certain aspects of this license are currently under investigation" report.
//
// The plain mockTSCheck() above answers {} for everything, so every component looks
// "unknown" under it; assertions about the unknown fallback need this one.
function mockLegalService() {
  const state = { request: null };
  TSCheck.CheckModule = mock.fn(async (payload) => {
    state.request = payload;
    const answers = {};
    const asked = (state.request && state.request.components) || {};
    for (const [componentPathKey, entry] of Object.entries(asked)) {
      answers[componentPathKey] = {};
      for (const licenseKey of entry.licenses || []) {
        answers[componentPathKey][licenseKey] = { status: 'SAT', obligations: [], rules: [] };
      }
    }
    return { status: 200, data: { [(state.request && state.request.key) || 'test-module']: answers } };
  });
  return state;
}

// The licenses the check request named for one component:version:path, or null when
// the component never made it into the request at all. Returning null rather than []
// keeps "asked about nothing" distinguishable from "was never asked".
function licensesAskedAbout(request, componentKey, version, pathIndex = 0) {
  const entry = request && request.components
    && request.components[componentKey + ':' + version + ':' + pathIndex];
  return entry ? entry.licenses : null;
}

// The licenses the saved analysis reports for one component:version on one path.
function licensesReportedFor(saved, componentKey, version, pathIndex = 0) {
  const component = (saved.components || []).find(c => c.key === componentKey);
  const versionEntry = component && (component.versions || []).find(v => v.version === version);
  const path = versionEntry && (versionEntry.paths || [])[pathIndex];
  return path ? (path.licenses || []).map(l => l.key) : null;
}

// A DB seeded with every collection the full analyze() pipeline touches.
function pipelineDb(components, infrastructureComponents = []) {
  return createStubDb({
    components,
    infrastructureComponents,
    cves: [], manualVulnerabilities: [], capabilities: [], analysis: [],
    modules: [makeModule()], logevents: [], companies: [makeCompany()], rules: []
  });
}

describe('Integration: Analysis pipeline', () => {
  let db, company, project, module, scan, user;

  beforeEach(() => {
    mockTSCheck();
  });

  describe('Analysis constructor', () => {
    it('initializes with correct defaults', () => {
      const analysis = new Analysis('COMP_1', 'MOD_1', false, null);
      assert.equal(analysis.companyId, 'COMP_1');
      assert.equal(analysis.moduleId, 'MOD_1');
      assert.equal(analysis.demo, false);
      assert.deepEqual(analysis.components, {});
      assert.deepEqual(analysis.licenses, {});
      assert.equal(analysis.statistics.components, 0);
      assert.equal(analysis.statistics.licenses, 0);
      assert.equal(analysis.statistics.legal.warnings, 0);
      assert.equal(analysis.statistics.legal.violations, 0);
    });
  });

  describe('gatherComponents', () => {
    it('collects dependencies from scan', () => {
      db = createStubDb({ components: [], infrastructureComponents: [] });
      company = makeCompany();
      project = makeProject();
      module = makeModule();
      scan = makeScan([
        makeDependency('npm:lodash', '4.17.21'),
        makeDependency('npm:express', '4.18.2')
      ]);

      const analysis = new Analysis(company._id, module._id, false, null);
      analysis.gatherComponents(db, scan, module, project, company);

      assert.equal(analysis.statistics.components, 2);
      assert.ok(analysis.components['npm:lodash']);
      assert.ok(analysis.components['npm:express']);
    });

    it('normalizes mvn: prefix to maven:', () => {
      db = createStubDb({ components: [], infrastructureComponents: [] });
      company = makeCompany();
      project = makeProject();
      module = makeModule();
      scan = makeScan([
        makeDependency('mvn:org.apache:commons:1.0.0', '1.0.0')
      ]);

      const analysis = new Analysis(company._id, module._id, false, null);
      analysis.gatherComponents(db, scan, module, project, company);

      assert.ok(analysis.components['maven:org.apache:commons:1.0.0']);
      assert.equal(analysis.components['mvn:org.apache:commons:1.0.0'], undefined);
    });

    it('handles empty scan dependencies', () => {
      db = createStubDb({ components: [] });
      company = makeCompany();
      project = makeProject();
      module = makeModule();
      scan = makeScan([]);

      const analysis = new Analysis(company._id, module._id, false, null);
      analysis.gatherComponents(db, scan, module, project, company);

      assert.equal(analysis.statistics.components, 0);
    });

    it('persists deepScanId from dependency.meta onto the matching version entry', () => {
      db = createStubDb({ components: [], infrastructureComponents: [] });
      company = makeCompany();
      project = makeProject();
      module = makeModule();
      scan = makeScan([
        makeDependency('npm:lodash', '4.17.21', {
          meta: { versions: [{ version: '4.17.21', deepScanId: 'EXEC_LODASH' }] }
        })
      ]);

      const analysis = new Analysis(company._id, module._id, false, null);
      analysis.gatherComponents(db, scan, module, project, company);

      const comp = analysis.components['npm:lodash'];
      assert.ok(comp);
      const v = comp.versions.find(x => x.version === '4.17.21');
      assert.equal(v.deepScanId, 'EXEC_LODASH');
    });

    it('attaches scan-declared licenses to synthetic 0.0.0 version and surfaces them via rebuildModuleObject', () => {
      // scan-root: top-level dep with no versions but declared licenses (e.g. private app).
      // Those licenses must reach the legal-evaluation request payload.
      db = createStubDb({
        components: [makeComponent('escra:frontend', [])],
        infrastructureComponents: []
      });
      company = makeCompany();
      project = makeProject();
      module = makeModule();
      const rootDep = makeDependency('escra:frontend', undefined, {
        licenses: [{ key: 'MPL-2.0', name: 'Mozilla Public License 2.0' }]
      });
      rootDep.versions = [];
      scan = makeScan([rootDep]);

      const analysis = new Analysis(company._id, module._id, false, null);
      analysis.gatherComponents(db, scan, module, project, company);

      const comp = analysis.components['escra:frontend'];
      assert.ok(comp, 'scan-root component must be gathered');
      assert.equal(comp.versions[0].version, '0.0.0');
      assert.deepEqual(comp.versions[0].licenses, [
        { key: 'MPL-2.0', name: 'Mozilla Public License 2.0' }
      ], 'synthetic version must carry the scan-declared licenses');

      // Pipe through the helper that drives the TSCheck request - MPL-2.0 must be in the payload.
      const payload = Utils.rebuildModuleObject(module, [comp], project);
      const entry = payload.components['escra:frontend:0.0.0:0'];
      assert.ok(entry, 'rebuildModuleObject must emit an entry for the synthetic 0.0.0 path');
      assert.deepEqual(entry.licenses, ['MPL-2.0']);
    });

    it('falls back to the only meta entry when dependency.versions is empty (top-level scan root)', () => {
      db = createStubDb({ components: [], infrastructureComponents: [] });
      company = makeCompany();
      project = makeProject();
      module = makeModule();
      const rootDep = makeDependency('unknown:commons-codec-1.15-sources', undefined, {
        meta: { versions: [{ version: '1.15', deepScanId: 'EXEC_ROOT' }] }
      });
      rootDep.versions = [];
      scan = makeScan([rootDep]);

      const analysis = new Analysis(company._id, module._id, false, null);
      analysis.gatherComponents(db, scan, module, project, company);

      const comp = analysis.components['unknown:commons-codec-1.15-sources'];
      assert.ok(comp);
      assert.equal(comp.versions.length, 1);
      assert.equal(comp.versions[0].deepScanId, 'EXEC_ROOT');
    });

    it('includes custom components from module', () => {
      db = createStubDb({ components: [], infrastructureComponents: [] });
      company = makeCompany();
      project = makeProject();
      module = makeModule({
        customComponents: [
          { key: 'npm:custom-lib', name: 'custom-lib', versions: ['1.0.0'], dependencies: [] }
        ]
      });
      scan = makeScan([]);

      const analysis = new Analysis(company._id, module._id, false, null);
      analysis.gatherComponents(db, scan, module, project, company);

      assert.equal(analysis.statistics.components, 1);
      assert.ok(analysis.components['npm:custom-lib']);
    });

    it('merges multiple paths for same component', () => {
      db = createStubDb({ components: [], infrastructureComponents: [] });
      company = makeCompany();
      project = makeProject();
      module = makeModule();
      const dep1 = makeDependency('npm:lodash', '4.17.21');
      const dep2 = makeDependency('npm:express', '4.18.2', {
        dependencies: [makeDependency('npm:lodash', '4.17.21')]
      });
      scan = makeScan([dep1, dep2]);

      const analysis = new Analysis(company._id, module._id, false, null);
      analysis.gatherComponents(db, scan, module, project, company);

      // lodash appears in root and as dep of express
      assert.equal(analysis.components['npm:lodash'].versions[0].paths.length, 2);
    });

    it('applies an assigned license to a versioned dependency that has no detected license', () => {
      db = createStubDb({
        components: [makeComponent('npm:foo', ['1.0.0'])],
        infrastructureComponents: []
      });
      company = makeCompany();
      project = makeProject();
      module = makeModule({
        componentConfig: { licensesSelected: [{ key: 'foo', version: '*', license: 'MIT' }] }
      });
      scan = makeScan([makeDependency('npm:foo', '1.0.0')]);

      const analysis = new Analysis(company._id, module._id, false, null);
      analysis.gatherComponents(db, scan, module, project, company);

      const comp = analysis.components['npm:foo'];
      assert.ok(comp, 'component must be gathered');
      assert.deepEqual(comp.versions[0].licenses, [{ key: 'MIT', name: 'MIT' }],
        'assigned license must be attached to the version entry');

      // It must reach the legal-evaluation payload via the existing channel.
      const payload = Utils.rebuildModuleObject(module, [comp], project);
      const entry = payload.components['npm:foo:1.0.0:0'];
      assert.ok(entry, 'rebuildModuleObject must emit an entry');
      assert.deepEqual(entry.licenses, ['MIT']);
    });

    it('does NOT override a dependency that already declares licenses (fill-only precedence)', () => {
      db = createStubDb({
        components: [makeComponent('escra:frontend', [])],
        infrastructureComponents: []
      });
      company = makeCompany();
      project = makeProject();
      module = makeModule({
        componentConfig: { licensesSelected: [{ key: 'escra:frontend', version: '*', license: 'MIT' }] }
      });
      const rootDep = makeDependency('escra:frontend', undefined, {
        licenses: [{ key: 'MPL-2.0', name: 'Mozilla Public License 2.0' }]
      });
      rootDep.versions = [];
      scan = makeScan([rootDep]);

      const analysis = new Analysis(company._id, module._id, false, null);
      analysis.gatherComponents(db, scan, module, project, company);

      const comp = analysis.components['escra:frontend'];
      assert.deepEqual(comp.versions[0].licenses, [
        { key: 'MPL-2.0', name: 'Mozilla Public License 2.0' }
      ], 'scan-declared licenses win; assigned resolution must not run');
    });

    it('applies company.defaultRootComponentLicense to the license-less root when no explicit selection', () => {
      db = createStubDb({
        components: [makeComponent('escra:frontend', ['2.0.0'])],
        infrastructureComponents: []
      });
      company = makeCompany({
        defaultRootComponentLicense: 'ACME-1.0',
        privateLicenses: [{ key: 'ACME-1.0', name: 'ACME Proprietary 1.0' }]
      });
      project = makeProject();
      module = makeModule();
      scan = makeScan([makeDependency('escra:frontend', '2.0.0')]);

      const analysis = new Analysis(company._id, module._id, false, null);
      analysis.gatherComponents(db, scan, module, project, company);

      const comp = analysis.components['escra:frontend'];
      assert.ok(comp.root, 'root flag must be set for path "/"');
      assert.deepEqual(comp.versions[0].licenses, [
        { key: 'ACME-1.0', name: 'ACME Proprietary 1.0' }
      ]);
    });

    it('leaves a license-less component without licenses when there is no assignment', () => {
      db = createStubDb({
        components: [makeComponent('npm:bar', ['1.0.0'])],
        infrastructureComponents: []
      });
      company = makeCompany();
      project = makeProject();
      module = makeModule();
      scan = makeScan([makeDependency('npm:bar', '1.0.0')]);

      const analysis = new Analysis(company._id, module._id, false, null);
      analysis.gatherComponents(db, scan, module, project, company);

      const comp = analysis.components['npm:bar'];
      assert.ok(comp, 'component still gathered');
      assert.equal(comp.versions[0].licenses, undefined, 'no licenses, unchanged behavior');
    });

    it('does not write back to module.componentConfig.licensesSelected', () => {
      db = createStubDb({
        components: [makeComponent('npm:foo', ['1.0.0'])],
        infrastructureComponents: []
      });
      company = makeCompany();
      project = makeProject();
      module = makeModule({
        componentConfig: { licensesSelected: [{ key: 'foo', version: '*', license: 'MIT' }] }
      });
      const before = JSON.parse(JSON.stringify(module.componentConfig.licensesSelected));
      scan = makeScan([makeDependency('npm:foo', '1.0.0')]);

      const analysis = new Analysis(company._id, module._id, false, null);
      analysis.gatherComponents(db, scan, module, project, company);

      assert.deepEqual(module.componentConfig.licensesSelected, before,
        'analyzer must not mutate/persist the module selection');
    });

    it('applies an explicit assigned license to a custom component but never the company default (custom is not root)', () => {
      db = createStubDb({ components: [], infrastructureComponents: [] });
      company = makeCompany({
        defaultRootComponentLicense: 'ACME-1.0',
        privateLicenses: [{ key: 'ACME-1.0', name: 'ACME Proprietary 1.0' }]
      });
      project = makeProject();

      // (a) custom component WITH an explicit licensesSelected entry -> assigned applies
      module = makeModule({
        customComponents: [
          { key: 'npm:custom-lib', name: 'custom-lib', versions: ['1.0.0'], dependencies: [] }
        ],
        componentConfig: { licensesSelected: [{ key: 'custom-lib', version: '*', license: 'BSD-3-Clause' }] }
      });
      scan = makeScan([]);
      let analysis = new Analysis(company._id, module._id, false, null);
      analysis.gatherComponents(db, scan, module, project, company);
      let comp = analysis.components['npm:custom-lib'];
      assert.ok(comp, 'custom component must be gathered');
      assert.deepEqual(comp.versions[0].licenses, [{ key: 'BSD-3-Clause', name: 'BSD-3-Clause' }],
        'explicit assigned license must apply to a custom component');

      // (b) custom component WITHOUT any explicit selection -> company default must NOT leak
      module = makeModule({
        customComponents: [
          { key: 'npm:custom-lib2', name: 'custom-lib2', versions: ['1.0.0'], dependencies: [] }
        ]
      });
      analysis = new Analysis(company._id, module._id, false, null);
      analysis.gatherComponents(db, scan, module, project, company);
      comp = analysis.components['npm:custom-lib2'];
      assert.ok(comp, 'custom component must be gathered');
      assert.equal(comp.versions[0].licenses, undefined,
        'company.defaultRootComponentLicense must not apply to a custom (non-root) component');
    });

    it('does not apply an assigned license to a VERSIONED dependency that already declares licenses (second guard arm)', () => {
      db = createStubDb({
        components: [makeComponent('npm:foo', ['1.0.0'])],
        infrastructureComponents: []
      });
      company = makeCompany();
      project = makeProject();
      module = makeModule({
        componentConfig: { licensesSelected: [{ key: 'foo', version: '*', license: 'MIT' }] }
      });
      // versioned dep (has versions) that ALSO carries dependency.licenses -> the
      // !(dependency.licenses && dependency.licenses.length) guard arm must skip resolution.
      const dep = makeDependency('npm:foo', '1.0.0', {
        licenses: [{ key: 'GPL-3.0', name: 'GPL-3.0' }]
      });
      scan = makeScan([dep]);

      const analysis = new Analysis(company._id, module._id, false, null);
      analysis.gatherComponents(db, scan, module, project, company);

      const comp = analysis.components['npm:foo'];
      assert.ok(comp, 'component must be gathered');
      // The requirement is that the assigned 'MIT' was NOT injected. This dep is the
      // scan root, and a root's scan-declared licenses are now carried onto the
      // working set so they reach the legal-check request (they used to be dropped
      // for a VERSIONED root, which is why a picked root-component license was
      // reported as "unknown"). So assert the intent directly: the scan's own
      // licenses survive and the assigned one never appears.
      const keys = (comp.versions[0].licenses || []).map(l => l.key);
      assert.deepEqual(keys, ['GPL-3.0'],
        'scan-declared licenses must survive on the root, got: ' + JSON.stringify(keys));
      assert.ok(!keys.includes('MIT'),
        'assigned license must not override a dependency that declares its own licenses');
    });

    it('does NOT carry scan-declared licenses for a versioned NON-root dependency', () => {
      // The root carve-out above must stay a carve-out: a nested dependency's
      // licenses still come back with its component record, so gatherComponents
      // leaves the working set alone.
      db = createStubDb({
        components: [makeComponent('npm:foo', ['1.0.0']), makeComponent('npm:bar', ['2.0.0'])],
        infrastructureComponents: []
      });
      company = makeCompany();
      project = makeProject();
      module = makeModule();
      const child = makeDependency('npm:bar', '2.0.0', {
        licenses: [{ key: 'GPL-3.0', name: 'GPL-3.0' }]
      });
      const root = makeDependency('npm:foo', '1.0.0');
      root.dependencies = [child];
      scan = makeScan([root]);

      const analysis = new Analysis(company._id, module._id, false, null);
      analysis.gatherComponents(db, scan, module, project, company);

      assert.equal(analysis.components['npm:bar'].versions[0].licenses, undefined,
        'a versioned non-root dependency keeps the original behaviour');
    });

    it('does not apply an assigned license to a versioned NON-ROOT dep that declares its own licenses', () => {
      // Restores the coverage the root carve-out moved out from under the
      // "(second guard arm)" test above. That test's dependency is the scan ROOT, so
      // it now leaves the assigned-license branch through the `!depLicenses` arm -
      // declaredScanLicenses returns the root's own licenses first. The
      // `!(dependency.licenses && dependency.licenses.length)` arm it is named for is
      // only reachable for a versioned NON-root dep, which is this case. Without it,
      // deleting that arm outright leaves the whole suite green.
      db = createStubDb({
        components: [makeComponent('npm:foo', ['1.0.0']), makeComponent('npm:bar', ['2.0.0'])],
        infrastructureComponents: []
      });
      company = makeCompany();
      project = makeProject();
      module = makeModule({
        componentConfig: { licensesSelected: [{ key: 'bar', version: '*', license: 'MIT' }] }
      });
      const child = makeDependency('npm:bar', '2.0.0', {
        licenses: [{ key: 'GPL-3.0', name: 'GPL-3.0' }]
      });
      const root = makeDependency('npm:foo', '1.0.0');
      root.dependencies = [child];
      scan = makeScan([root]);

      const analysis = new Analysis(company._id, module._id, false, null);
      analysis.gatherComponents(db, scan, module, project, company);

      const keys = (analysis.components['npm:bar'].versions[0].licenses || []).map(l => l.key);
      assert.ok(!keys.includes('MIT'),
        'assigned MIT must not be injected into a dep that declares its own licenses, got: ' + JSON.stringify(keys));
    });
  });

  describe('addComponentError', () => {
    it('adds problems and increments statistics', () => {
      const analysis = new Analysis('C1', 'M1', false, null);
      analysis.components['npm:test'] = { key: 'npm:test', versions: [{ version: '1.0.0' }], status: 'ok' };

      analysis.addComponentError('vulnerability', 'warnings', 'CVE-2021-1', 'npm:test', '1.0.0');

      assert.equal(analysis.statistics.vulnerability.warnings, 1);
      assert.equal(analysis.components['npm:test'].problems.vulnerability.length, 1);
      assert.equal(analysis.components['npm:test'].problems.vulnerability[0].status, 'warnings');
    });

    it('skips counting when notCount is true', () => {
      const analysis = new Analysis('C1', 'M1', false, null);
      analysis.components['npm:test'] = { key: 'npm:test', versions: [], status: 'ok' };

      analysis.addComponentError('legal', 'warnings', 'unknown', 'npm:test', '1.0.0', null, true);

      assert.equal(analysis.statistics.legal.warnings, 0);
      assert.equal(analysis.components['npm:test'].problems.legal.length, 1);
    });

    it('throws for invalid category', () => {
      const analysis = new Analysis('C1', 'M1', false, null);
      analysis.components['npm:test'] = { key: 'npm:test', versions: [], status: 'ok' };

      assert.throws(() => {
        analysis.addComponentError('invalid', 'warnings', 'msg', 'npm:test');
      });
    });
  });

  describe('eachDependency', () => {
    it('walks nested dependencies', () => {
      const analysis = new Analysis('C1', 'M1', false, null);
      const paths = [];
      const scan = makeScan([
        makeDependency('npm:a', '1.0.0', {
          dependencies: [makeDependency('npm:b', '2.0.0')]
        })
      ]);

      analysis.eachDependency(scan, function (dep, path) {
        paths.push(path);
      });

      assert.equal(paths.length, 2);
      // Root-level deps get path='/' per the walk() function
      assert.equal(paths[0], '/');
      // Nested dep 'npm:b' under 'npm:a' gets path containing the parent component
      assert.ok(paths[1].length > 1);
    });

    it('handles null scan gracefully', () => {
      const analysis = new Analysis('C1', 'M1', false, null);
      let count = 0;
      analysis.eachDependency(null, () => count++);
      assert.equal(count, 0);
    });
  });

  describe('createResult', () => {
    it('returns result with all expected keys', () => {
      const analysis = new Analysis('C1', 'M1', false, null);
      analysis.components['npm:test'] = {
        key: 'npm:test',
        versions: [{ version: '1.0.0', paths: ['/'] }],
        status: 'ok'
      };
      analysis.licenses['MIT'] = {
        key: 'MIT',
        name: 'MIT License',
        components: [{ componentKey: 'npm:test', version: '1.0.0' }]
      };

      const result = analysis.createResult('SCAN_1', 'v1.0', 'release-1', 'main', null, null, null, false);

      assert.ok(result._id);
      assert.ok(result.date);
      assert.equal(result.scanId, 'SCAN_1');
      assert.equal(result.companyId, 'C1');
      assert.equal(result.moduleId, 'M1');
      assert.ok(Array.isArray(result.components));
      assert.ok(Array.isArray(result.licenses));
      assert.ok(result.statistics);
      assert.equal(result.tag, 'v1.0');
      assert.equal(result.release, 'release-1');
      assert.equal(result.branch, 'main');
      assert.equal(result.latest, true);
    });

    it('passes through linkedModules from scan', () => {
      const analysis = new Analysis('C1', 'M1', false, null);
      const linkedModules = [
        { _id: 'comp1', key: 'npm:lodash', module: { _id: 'MOD_2', name: 'Other Module' } }
      ];

      const result = analysis.createResult('SCAN_1', null, null, null, null, linkedModules, null, false);

      assert.deepEqual(result.linkedModules, linkedModules);
      assert.equal(result.linkedReleases, null);
    });

    it('passes through linkedReleases from scan', () => {
      const analysis = new Analysis('C1', 'M1', false, null);
      const linkedReleases = [
        { _id: 'comp1', key: 'npm:express', approve: { _id: 'APR_1', name: 'Release 1.0' } }
      ];

      const result = analysis.createResult('SCAN_1', null, null, null, null, null, linkedReleases, false);

      assert.equal(result.linkedModules, null);
      assert.deepEqual(result.linkedReleases, linkedReleases);
    });

    it('defaults linkedModules and linkedReleases to null when not provided', () => {
      const analysis = new Analysis('C1', 'M1', false, null);

      const result = analysis.createResult('SCAN_1', null, null, null, null, null, null, false);

      assert.equal(result.linkedModules, null);
      assert.equal(result.linkedReleases, null);
    });
  });

  describe('viabilityAnalysis', () => {
    it('skips when viabilityConfig not enabled', async () => {
      db = createStubDb({ components: [], infrastructureComponents: [] });
      company = makeCompany();
      project = makeProject();
      module = makeModule();

      const analysis = new Analysis(company._id, module._id, false, null);
      await analysis.viabilityAnalysis(db, module, project, company);

      assert.deepEqual(analysis.viabilityConfig, {});
    });

    it('runs when viabilityConfig enabled', async () => {
      const comp = makeComponent('npm:test', ['1.0.0']);
      db = createStubDb({ components: [comp], infrastructureComponents: [] });
      company = makeCompany();
      project = makeProject();
      module = makeModule({
        viabilityConfig: { enabled: true, noInfoLevel: 2, minConfidence: 1, warningThreshold: 2, violationThreshold: 1 }
      });

      const analysis = new Analysis(company._id, module._id, false, null);
      analysis.components['npm:test'] = { key: 'npm:test', versions: [{ version: '1.0.0' }], status: 'ok' };

      await analysis.viabilityAnalysis(db, module, project, company);

      assert.deepEqual(analysis.viabilityConfig, module.viabilityConfig);
    });
  });

  describe('ossfAnalysis', () => {
    it('skips when ossfConfig not enabled', async () => {
      db = createStubDb({ components: [], infrastructureComponents: [] });
      company = makeCompany();
      project = makeProject();
      module = makeModule();

      const analysis = new Analysis(company._id, module._id, false, null);
      await analysis.ossfAnalysis(db, module, project, company);

      assert.deepEqual(analysis.ossfConfig, {});
    });
  });

  describe('versioningAnalysis', () => {
    it('skips when versioningConfig not enabled', async () => {
      db = createStubDb({ components: [], infrastructureComponents: [] });
      company = makeCompany();
      project = makeProject();
      module = makeModule();

      const analysis = new Analysis(company._id, module._id, false, null);
      await analysis.versioningAnalysis(db, module, project, company);

      assert.deepEqual(analysis.versioningConfig, {});
    });

    it('detects outdated versions when enabled', async () => {
      const comp = makeComponent('npm:test', ['1.0.0', '2.0.0', '3.0.0', '4.0.0', '5.0.0']);
      db = createStubDb({ components: [comp], infrastructureComponents: [] });
      company = makeCompany();
      project = makeProject();
      module = makeModule({
        versioningConfig: { enabled: true, warningThreshold: 2, violationThreshold: 3 }
      });

      const analysis = new Analysis(company._id, module._id, false, null);
      analysis.components['npm:test'] = {
        key: 'npm:test',
        versions: [{ version: '1.0.0' }],
        status: 'ok',
        name: 'test'
      };

      await analysis.versioningAnalysis(db, module, project, company);

      assert.ok(analysis.statistics.versioning.warnings > 0 || analysis.statistics.versioning.violations > 0);
    });

    it('does not crash on jump check when lastAnalysis carries a legacy object-typed version', async () => {
      // Pre-80d0159 ("empty version in dependency"), gatherComponents did
      //   `version = dependency.versions && dependency.versions[0] || dependency.versions`
      // so a dep with an empty `versions` array persisted `version: []` (an object)
      // into the analysis collection. Such documents still exist in MongoDB; on the
      // next run they arrive as `lastAnalysis` and getJumpStatus fed the object
      // straight into semver.gt → TypeError: Invalid version. Must be a string.
      const comp = makeComponent('npm:lodash', ['1.0.0', '2.0.0', '3.0.0', '4.17.21', '5.0.0']);
      db = createStubDb({ components: [comp], infrastructureComponents: [] });
      company = makeCompany();
      project = makeProject();
      module = makeModule({
        versioningConfig: { enabled: true, jump: true, warningThreshold: 2, violationThreshold: 3 }
      });
      scan = makeScan([makeDependency('npm:lodash', '5.0.0')]);

      const lastAnalysis = {
        components: [{ key: 'npm:lodash', versions: [{ version: [] }] }]
      };
      const analysis = new Analysis(company._id, module._id, false, lastAnalysis);
      analysis.gatherComponents(db, scan, module, project, company);

      await assert.doesNotReject(
        analysis.versioningAnalysis(db, module, project, company),
        'versioningAnalysis must tolerate legacy object-typed versions in lastAnalysis'
      );
    });
  });

  describe('endoflifeAnalysis', () => {
    it('skips when no endoflife policy enabled', async () => {
      db = createStubDb({ components: [], infrastructureComponents: [] });
      company = makeCompany();
      project = makeProject();
      module = makeModule();

      const analysis = new Analysis(company._id, module._id, false, null);
      await analysis.endoflifeAnalysis(db, module, project, company);

      assert.deepEqual(analysis.endoflifePolicy, {});
    });

    it('uses module endoflife policy when enabled (overrides company)', async () => {
      const pastDate = new Date();
      pastDate.setMonth(pastDate.getMonth() - 3);
      const comp = makeComponent('npm:test', ['1.0.0'], {
        crawlerInfo: {
          endoflife: {
            info: [{ name: 1, isEol: true, eolFrom: pastDate.toISOString() }]
          }
        }
      });
      db = createStubDb({ components: [comp], infrastructureComponents: [] });
      company = makeCompany({ endoflifePolicy: { enabled: true, warningThreshold: 24, violationThreshold: 12 } });
      project = makeProject();
      module = makeModule({
        endoflifePolicy: { enabled: true, warningThreshold: 12, violationThreshold: 6 }
      });

      const analysis = new Analysis(company._id, module._id, false, null);
      analysis.components['npm:test'] = {
        key: 'npm:test',
        versions: [{ version: '1.0.0' }],
        status: 'ok'
      };

      await analysis.endoflifeAnalysis(db, module, project, company);

      assert.deepEqual(analysis.endoflifePolicy, module.endoflifePolicy);
    });
  });

  describe('vulnerabilityAnalysis confidenceMinScore', () => {
    it('uses module.confidenceMinScore when set', async () => {
      db = createStubDb({ manualVulnerabilities: [] });
      company = makeCompany();
      project = makeProject({ confidenceMinScore: 2 });
      module = makeModule({ confidenceMinScore: 5 });

      const analysis = new Analysis(company._id, module._id, false, null);
      await analysis.vulnerabilityAnalysis(db, module, project, company);

      assert.equal(analysis.confidenceMinScore, 5);
    });

    it('falls back to project.confidenceMinScore when module is missing it', async () => {
      db = createStubDb({ manualVulnerabilities: [] });
      company = makeCompany();
      project = makeProject({ confidenceMinScore: 2 });
      module = makeModule();

      const analysis = new Analysis(company._id, module._id, false, null);
      await analysis.vulnerabilityAnalysis(db, module, project, company);

      assert.equal(analysis.confidenceMinScore, 2);
    });

    it('defaults to 4 when neither module nor project set it', async () => {
      db = createStubDb({ manualVulnerabilities: [] });
      company = makeCompany();
      project = makeProject();
      module = makeModule();

      const analysis = new Analysis(company._id, module._id, false, null);
      await analysis.vulnerabilityAnalysis(db, module, project, company);

      assert.equal(analysis.confidenceMinScore, 4);
    });
  });

  describe('encryptionAnalysis', () => {
    it('flags matching crypto algorithms', async () => {
      const comp = makeComponent('npm:test', ['1.0.0']);
      db = createStubDb({ components: [comp], infrastructureComponents: [] });
      company = makeCompany({
        algorithmsConfig: [{ key: 'aes', exportStrict: ['US'] }]
      });
      project = makeProject();
      module = makeModule();

      const analysis = new Analysis(company._id, module._id, false, null);
      analysis.components['npm:test'] = {
        key: 'npm:test',
        versions: [{ version: '1.0.0' }],
        status: 'ok',
        crypto_algorithms: [{ algorithm: 'aes' }]
      };

      await analysis.encryptionAnalysis(db, module, project, company);

      assert.equal(analysis.statistics.encryption.violations, 1);
    });

    it('no flags when no matching algorithms', async () => {
      const comp = makeComponent('npm:test', ['1.0.0']);
      db = createStubDb({ components: [comp], infrastructureComponents: [] });
      company = makeCompany({ algorithmsConfig: [] });
      project = makeProject();
      module = makeModule();

      const analysis = new Analysis(company._id, module._id, false, null);
      analysis.components['npm:test'] = {
        key: 'npm:test',
        versions: [{ version: '1.0.0' }],
        status: 'ok'
      };

      await analysis.encryptionAnalysis(db, module, project, company);

      assert.equal(analysis.statistics.encryption.violations, 0);
      assert.equal(analysis.statistics.encryption.warnings, 0);
    });
  });

  describe('aiAnalysis', () => {
    it('carries ai_models from the component onto the analysed component', async () => {
      const comp = makeComponent('npm:test', ['1.0.0'], {
        ai_models: [{ name: 'GPT-Mini', type: 'machine-learning-model', version: '1.0', provider: 'OpenAI', task: 'text-generation' }]
      });
      db = createStubDb({ components: [comp], infrastructureComponents: [] });
      company = makeCompany();
      project = makeProject();
      module = makeModule();

      const analysis = new Analysis(company._id, module._id, false, null);
      analysis.components['npm:test'] = {
        key: 'npm:test',
        versions: [{ version: '1.0.0' }],
        status: 'ok'
      };

      await analysis.aiAnalysis(db, module, project, company);

      assert.deepEqual(analysis.components['npm:test'].ai_models,
        [{ name: 'GPT-Mini', type: 'machine-learning-model', version: '1.0', provider: 'OpenAI', task: 'text-generation' }]);
    });

    it('leaves components without ai_models untouched', async () => {
      const comp = makeComponent('npm:test', ['1.0.0']);
      db = createStubDb({ components: [comp], infrastructureComponents: [] });
      company = makeCompany();
      project = makeProject();
      module = makeModule();

      const analysis = new Analysis(company._id, module._id, false, null);
      analysis.components['npm:test'] = {
        key: 'npm:test',
        versions: [{ version: '1.0.0' }],
        status: 'ok'
      };

      await analysis.aiAnalysis(db, module, project, company);

      assert.equal(analysis.components['npm:test'].ai_models, undefined);
    });
  });

  describe('ciaAnalysis', () => {
    it('sets ciaRequirements from module', () => {
      db = createStubDb({});
      module = makeModule({ ciaRequirements: { confidentiality: 'high' } });
      project = makeProject();

      const analysis = new Analysis('C1', 'M1', false, null);
      analysis.ciaAnalysis(db, module, project);

      assert.deepEqual(analysis.ciaRequirements, { confidentiality: 'high' });
    });

    it('merges project and module requirements', () => {
      db = createStubDb({});
      module = makeModule({ ciaRequirements: { confidentiality: 'high' } });
      project = makeProject({ ciaRequirements: { availability: 'medium' } });

      const analysis = new Analysis('C1', 'M1', false, null);
      analysis.ciaAnalysis(db, module, project);

      assert.equal(analysis.ciaRequirements.confidentiality, 'high');
    });
  });

  describe('ModuleAnalyzer.analyzeModule', () => {
    it('returns null when no scan and no custom components', async () => {
      db = createStubDb({ modules: [], components: [], analysis: [], logevents: [], companies: [] });
      company = makeCompany();
      project = makeProject();
      module = makeModule({ customComponents: [] });
      user = makeUser();

      const analyzer = new ModuleAnalyzer(db, company, project, module, null, user, null, false, 'req-1');
      const result = await analyzer.analyzeModule();

      assert.equal(result, null);
    });

    it('runs full pipeline with minimal scan', async () => {
      const comp = makeComponent('npm:lodash', ['4.17.21'], {
        declaredLicenses: [{ key: 'MIT', name: 'MIT License' }]
      });
      db = createStubDb({
        components: [comp],
        infrastructureComponents: [],
        cves: [],
        manualVulnerabilities: [],
        capabilities: [],
        analysis: [],
        modules: [],
        logevents: [],
        companies: [makeCompany()],
        rules: []
      });
      company = makeCompany();
      project = makeProject();
      module = makeModule();
      scan = makeScan([makeDependency('npm:lodash', '4.17.21')]);
      user = makeUser();

      const analyzer = new ModuleAnalyzer(db, company, project, module, scan, user, null, false, 'req-1');
      const result = await analyzer.analyzeModule();

      assert.ok(result);
      assert.ok(result.components);
      assert.ok(result.statistics);
      assert.equal(result.statistics.components, 1);
    });
  });

  describe('ModuleAnalyzer.analyze (full flow)', () => {
    it('saves result and returns analysis', async () => {
      const comp = makeComponent('npm:test-lib', ['1.0.0'], {
        declaredLicenses: [{ key: 'MIT', name: 'MIT' }]
      });
      db = createStubDb({
        components: [comp],
        infrastructureComponents: [],
        cves: [],
        manualVulnerabilities: [],
        capabilities: [],
        analysis: [],
        modules: [makeModule()],
        logevents: [],
        companies: [makeCompany()],
        rules: []
      });
      company = makeCompany();
      project = makeProject();
      module = makeModule();
      scan = makeScan([makeDependency('npm:test-lib', '1.0.0')]);
      user = makeUser();

      const analyzer = new ModuleAnalyzer(db, company, project, module, scan, user, null, false, 'req-1');
      const result = await analyzer.analyze();

      assert.ok(result);
      assert.ok(db._collections.analysis.length > 0);
    });

    it('persists linkedModules and linkedReleases from module to analysis', async () => {
      const comp = makeComponent('npm:test-lib', ['1.0.0'], {
        declaredLicenses: [{ key: 'MIT', name: 'MIT' }]
      });
      db = createStubDb({
        components: [comp],
        infrastructureComponents: [],
        cves: [],
        manualVulnerabilities: [],
        capabilities: [],
        analysis: [],
        modules: [makeModule()],
        logevents: [],
        companies: [makeCompany()],
        rules: []
      });
      company = makeCompany();
      project = makeProject();
      const linkedModules = [
        { _id: 'comp1', key: 'npm:lodash', module: { _id: 'MOD_2', name: 'Linked Module' }, parentPath: '/', hash: 12345 }
      ];
      const linkedReleases = [
        { _id: 'comp2', key: 'npm:express', approve: { _id: 'APR_1', name: 'Release 1' }, parentPath: '/', hash: 67890 }
      ];
      // linkedModules/linkedReleases are sourced from the module (since 6cc717c
      // "store info inside module"), not the scan.
      module = makeModule({ linkedModules, linkedReleases });
      scan = makeScan([makeDependency('npm:test-lib', '1.0.0')]);
      user = makeUser();

      const analyzer = new ModuleAnalyzer(db, company, project, module, scan, user, null, false, 'req-2');
      await analyzer.analyze();

      const savedAnalysis = db._collections.analysis[0];
      assert.ok(savedAnalysis);
      assert.deepEqual(savedAnalysis.linkedModules, linkedModules);
      assert.deepEqual(savedAnalysis.linkedReleases, linkedReleases);
    });

    it('assigned license reaches analysis.licenses for an in-DB versioned dep with no license (not "unknown")', async () => {
      const comp = makeComponent('npm:foo', ['1.0.0']);
      db = createStubDb({
        components: [comp],
        infrastructureComponents: [],
        cves: [], manualVulnerabilities: [], capabilities: [], analysis: [],
        modules: [makeModule()], logevents: [], companies: [makeCompany()], rules: []
      });
      company = makeCompany();
      project = makeProject();
      module = makeModule({
        componentConfig: { licensesSelected: [{ key: 'foo', version: '*', license: 'MIT' }] }
      });
      scan = makeScan([makeDependency('npm:foo', '1.0.0')]);
      user = makeUser();

      const analyzer = new ModuleAnalyzer(db, company, project, module, scan, user, null, false, 'e2e-1');
      await analyzer.analyze();

      const saved = db._collections.analysis[0];
      const keys = (saved.licenses || []).map(l => l.key);
      assert.ok(keys.includes('MIT'), 'expected MIT in analysis.licenses, got: ' + JSON.stringify(keys));
      assert.ok(!keys.includes('unknown'), 'must not be unknown, got: ' + JSON.stringify(keys));
    });

    it('a picked license on a VERSIONED root reaches the analysis (e2e regression)', async () => {
      // The root-license bug as seen in the wild: module test-cydx-rt-1786455096800,
      // root npm:rt-app 1.0.0, no children. ts-app writes the picked license into
      // the scan; the component catalogue entry has none of its own. Before the fix
      // gatherComponents dropped the root's scan-declared licenses because the
      // dependency had versions, so the pick reached neither the analysis nor the
      // legal-check request and the root was reported as "unknown".
      const comp = makeComponent('npm:rt-app', ['1.0.0']);
      db = createStubDb({
        components: [comp],
        infrastructureComponents: [],
        cves: [], manualVulnerabilities: [], capabilities: [], analysis: [],
        modules: [makeModule()], logevents: [], companies: [makeCompany()], rules: []
      });
      company = makeCompany();
      project = makeProject();
      module = makeModule({
        componentConfig: { licensesSelected: [{ key: 'npm:rt-app', license: 'ROOT_SAMPLE' }] }
      });
      const root = makeDependency('npm:rt-app', '1.0.0', {
        licenses: [{ key: 'ROOT_SAMPLE', name: 'ROOT_SAMPLE' }]
      });
      scan = makeScan([root]);
      user = makeUser();

      const analyzer = new ModuleAnalyzer(db, company, project, module, scan, user, null, false, 'e2e-root');
      await analyzer.analyze();

      const saved = db._collections.analysis[0];
      const keys = (saved.licenses || []).map(l => l.key);
      assert.ok(keys.includes('ROOT_SAMPLE'),
        'picked root license must reach the analysis, got: ' + JSON.stringify(keys));
      assert.ok(!keys.includes('unknown'),
        'root must not fall back to unknown, got: ' + JSON.stringify(keys));
    });

    it('does NOT override a DB component that already carries its own license (fill-only, e2e)', async () => {
      const comp = makeComponent('npm:foo', ['1.0.0'], {
        declaredLicenses: [{ key: 'Apache-2.0', name: 'Apache-2.0' }]
      });
      db = createStubDb({
        components: [comp],
        infrastructureComponents: [],
        cves: [], manualVulnerabilities: [], capabilities: [], analysis: [],
        modules: [makeModule()], logevents: [], companies: [makeCompany()], rules: []
      });
      company = makeCompany();
      project = makeProject();
      module = makeModule({
        componentConfig: { licensesSelected: [{ key: 'foo', version: '*', license: 'MIT' }] }
      });
      scan = makeScan([makeDependency('npm:foo', '1.0.0')]);
      user = makeUser();

      const analyzer = new ModuleAnalyzer(db, company, project, module, scan, user, null, false, 'e2e-2');
      await analyzer.analyze();

      const saved = db._collections.analysis[0];
      const keys = (saved.licenses || []).map(l => l.key);
      assert.ok(keys.includes('Apache-2.0'), 'DB-declared license must win, got: ' + JSON.stringify(keys));
      assert.ok(!keys.includes('MIT'), 'assigned MIT must NOT override an already-licensed component, got: ' + JSON.stringify(keys));
    });
  });

  // The half of the root-license bug that the analysis document cannot show.
  //
  // analysis.licenses is fed by legalAnalysis through the declaredLicenses bridge in
  // Analysis.loadComponent. The legal-check REQUEST is built by
  // Utils.rebuildModuleObject from a SECOND, independent read of the component in
  // getModuleComponents, which never sees that bridge - and it is the request that
  // decides whether the component comes back "unknown". So an assertion on
  // analysis.licenses passes with mergeWorkingSetLicenses deleted outright; only an
  // assertion on the request itself pins the fix.
  describe('legal-check request (ts-app issue #29)', () => {
    it('sends the picked root license to the legal check, not an empty license list', async () => {
      db = pipelineDb([makeComponent('npm:rt-app', ['1.0.0'])]);
      company = makeCompany();
      project = makeProject();
      module = makeModule({
        componentConfig: { licensesSelected: [{ key: 'npm:rt-app', license: 'ROOT_SAMPLE' }] }
      });
      const root = makeDependency('npm:rt-app', '1.0.0', {
        licenses: [{ key: 'ROOT_SAMPLE', name: 'ROOT_SAMPLE' }]
      });
      scan = makeScan([root]);
      user = makeUser();
      const legal = mockLegalService();

      await new ModuleAnalyzer(db, company, project, module, scan, user, null, false, 'req-root').analyze();

      const asked = licensesAskedAbout(legal.request, 'npm:rt-app', '1.0.0');
      assert.deepEqual(asked, ['ROOT_SAMPLE'],
        'the check must be asked about the picked root license, got: ' + JSON.stringify(asked));
    });

    it('reports the root as licensed, not "unknown", once the check is asked the right question', async () => {
      // The user-visible symptom of the ticket, end to end against a legal service
      // that only answers about what it was asked.
      db = pipelineDb([makeComponent('npm:rt-app', ['1.0.0'])]);
      company = makeCompany();
      project = makeProject();
      module = makeModule({
        componentConfig: { licensesSelected: [{ key: 'npm:rt-app', license: 'ROOT_SAMPLE' }] }
      });
      scan = makeScan([makeDependency('npm:rt-app', '1.0.0', {
        licenses: [{ key: 'ROOT_SAMPLE', name: 'ROOT_SAMPLE' }]
      })]);
      user = makeUser();
      mockLegalService();

      await new ModuleAnalyzer(db, company, project, module, scan, user, null, false, 'req-unknown').analyze();

      const saved = db._collections.analysis[0];
      const reported = licensesReportedFor(saved, 'npm:rt-app', '1.0.0');
      assert.deepEqual(reported, ['ROOT_SAMPLE'],
        'the root path must report the picked license, got: ' + JSON.stringify(reported));
      assert.equal(saved.components[0].statuses.legal, 'ok',
        'the root must not be left in a legal warning state');
    });

    it('still reports "unknown" for a root with no license anywhere', async () => {
      // The other direction. Without this, the test above could pass against a legal
      // service stub that answers everything, and the "unknown" fallback - the thing
      // the ticket is about - would never be exercised at all.
      db = pipelineDb([makeComponent('npm:bare-app', ['1.0.0'])]);
      company = makeCompany();
      project = makeProject();
      module = makeModule();
      scan = makeScan([makeDependency('npm:bare-app', '1.0.0')]);
      user = makeUser();
      const legal = mockLegalService();

      await new ModuleAnalyzer(db, company, project, module, scan, user, null, false, 'req-bare').analyze();

      assert.deepEqual(licensesAskedAbout(legal.request, 'npm:bare-app', '1.0.0'), [],
        'a component with no license anywhere must be sent with an empty license list');
      const saved = db._collections.analysis[0];
      assert.deepEqual(licensesReportedFor(saved, 'npm:bare-app', '1.0.0'), ['unknown'],
        'a component the check cannot answer for must still fall back to "unknown"');
    });

    it('sends a component OWN license to the legal check, never the assigned one', async () => {
      db = pipelineDb([makeComponent('npm:foo', ['1.0.0'], {
        declaredLicenses: [{ key: 'Apache-2.0', name: 'Apache-2.0' }]
      })]);
      company = makeCompany();
      project = makeProject();
      module = makeModule({
        componentConfig: { licensesSelected: [{ key: 'foo', version: '*', license: 'MIT' }] }
      });
      scan = makeScan([makeDependency('npm:foo', '1.0.0')]);
      user = makeUser();
      const legal = mockLegalService();

      await new ModuleAnalyzer(db, company, project, module, scan, user, null, false, 'req-own').analyze();

      const asked = licensesAskedAbout(legal.request, 'npm:foo', '1.0.0');
      assert.ok(asked.includes('Apache-2.0'),
        'the component own license must be sent, got: ' + JSON.stringify(asked));
      assert.ok(!asked.includes('MIT'),
        'the assigned license must never be sent for an already-licensed component, got: ' + JSON.stringify(asked));
    });

    it('sends the picked license of an im: root component to the legal check', async () => {
      // Infrastructure components are read from a different collection by BOTH
      // Analysis.loadComponent and getModuleComponents; the merge has to reach that
      // branch too.
      db = pipelineDb([], [makeComponent('im:docker:base-image', ['1.0.0'])]);
      company = makeCompany();
      project = makeProject();
      module = makeModule({
        componentConfig: { licensesSelected: [{ key: 'im:docker:base-image', license: 'ROOT_SAMPLE' }] }
      });
      scan = makeScan([makeDependency('im:docker:base-image', '1.0.0', {
        licenses: [{ key: 'ROOT_SAMPLE', name: 'ROOT_SAMPLE' }]
      })]);
      user = makeUser();
      const legal = mockLegalService();

      await new ModuleAnalyzer(db, company, project, module, scan, user, null, false, 'req-im').analyze();

      const asked = licensesAskedAbout(legal.request, 'im:docker:base-image', '1.0.0');
      assert.deepEqual(asked, ['ROOT_SAMPLE'],
        'an im: root must be asked about its picked license, got: ' + JSON.stringify(asked));
    });

    it('does not send an assigned license for a component licensed only on an unused version', async () => {
      // The invariant mergeWorkingSetLicenses own unit test states - "does not fill
      // one version when another version carries a license" - asserted where it
      // actually has to hold. getModuleComponents must merge BEFORE it filters
      // data.versions down to the versions in use: filter first and the version
      // carrying the real license is gone by the time componentHasLicense is
      // computed, so the guard cannot see it and the assigned license leaks through.
      db = pipelineDb([makeComponent('npm:foo', [
        { version: '1.0.0' },
        { version: '2.0.0', licenses: [{ key: 'Apache-2.0', name: 'Apache-2.0' }] }
      ])]);
      company = makeCompany();
      project = makeProject();
      module = makeModule({
        componentConfig: { licensesSelected: [{ key: 'foo', version: '*', license: 'MIT' }] }
      });
      scan = makeScan([makeDependency('npm:foo', '1.0.0')]);
      user = makeUser();
      const legal = mockLegalService();

      await new ModuleAnalyzer(db, company, project, module, scan, user, null, false, 'req-unused').analyze();

      const asked = licensesAskedAbout(legal.request, 'npm:foo', '1.0.0');
      const rolledUp = (db._collections.analysis[0].licenses || []).map(l => l.key);
      assert.ok(!asked.includes('MIT'),
        'assigned MIT must not be sent for a component that carries a license on another version'
        + ' - the check was asked about ' + JSON.stringify(asked)
        + ' while analysis.licenses rolled up ' + JSON.stringify(rolledUp));
    });
  });

  // A license a compliance manager set BY HAND on a component the scan could not match
  // ts-app unshifts it onto the scan node marked
  // `origin: 'ts-component-pick'` and strips that marker from every write onto the shared
  // `components` catalogue, so the scan is the only channel it travels on.
  //
  // Unlike the root pick above, the target is an ORDINARY dependency: it has versions and
  // it is not at path '/', which is exactly what every rule in this file used to key on.
  describe('manually set component license (ts-app issue #139)', () => {
    const PICK = { key: 'AFL-1.2', name: 'AFL-1.2', origin: 'ts-component-pick' };

    // The shape ts-app produces: the root, plus the resolved component as its child.
    function scanWithPickedChild(childLicenses) {
      return makeScan([makeDependency('npm:host-app', '1.0.0', {
        dependencies: [makeDependency('maven:vbo.multipart-request:multipart-request', '1.0.2', {
          licenses: childLicenses
        })]
      })]);
    }

    function moduleWithResolution() {
      return makeModule({
        componentConfig: {
          licensesSelected: [{
            key: 'maven:vbo.multipart-request:multipart-request',
            license: 'AFL-1.2',
            justification: 'Checked the LICENSE file in the released jar.'
          }]
        }
      });
    }

    it('asks the legal check about a license set on an ordinary dependency', async () => {
      // THE REGRESSION. A non-root node with versions had its scan licenses dropped
      // outright, and the injected entry simultaneously disqualified the
      // resolveAssignedLicense fallback - so the check was asked about nothing.
      db = pipelineDb([
        makeComponent('npm:host-app', ['1.0.0']),
        makeComponent('maven:vbo.multipart-request:multipart-request', ['1.0.2'])
      ]);
      company = makeCompany();
      project = makeProject();
      module = moduleWithResolution();
      scan = scanWithPickedChild([PICK]);
      user = makeUser();
      const legal = mockLegalService();

      await new ModuleAnalyzer(db, company, project, module, scan, user, null, false, 'req-pick').analyze();

      const asked = licensesAskedAbout(legal.request, 'maven:vbo.multipart-request:multipart-request', '1.0.2');
      assert.deepEqual(asked, ['AFL-1.2'],
        'the check must be asked about the manually set license, got: ' + JSON.stringify(asked));
    });

    it('reports the component as licensed instead of "unknown"', async () => {
      // The user-visible symptom: risk created, entry stored on the module, analysis
      // unchanged.
      db = pipelineDb([
        makeComponent('npm:host-app', ['1.0.0']),
        makeComponent('maven:vbo.multipart-request:multipart-request', ['1.0.2'])
      ]);
      company = makeCompany();
      project = makeProject();
      module = moduleWithResolution();
      scan = scanWithPickedChild([PICK]);
      user = makeUser();
      mockLegalService();

      await new ModuleAnalyzer(db, company, project, module, scan, user, null, false, 'req-pick-report').analyze();

      const saved = db._collections.analysis[0];
      const reported = licensesReportedFor(saved, 'maven:vbo.multipart-request:multipart-request', '1.0.2');
      assert.deepEqual(reported, ['AFL-1.2'],
        'the path must report the manually set license, got: ' + JSON.stringify(reported));
    });

    it('replaces a declaration the catalogue could not match', async () => {
      // The population the ts-app picker is actually offered for: the component
      // already carries a license nobody could resolve. Every other bridge between
      // the working set and a component record is fill-only, which left that entry
      // in place and the determination doing nothing.
      db = pipelineDb([
        makeComponent('npm:host-app', ['1.0.0']),
        makeComponent('maven:vbo.multipart-request:multipart-request', [
          { version: '1.0.2', licenses: [{ name: 'The Weird Software License' }] }
        ])
      ]);
      company = makeCompany();
      project = makeProject();
      module = moduleWithResolution();
      scan = scanWithPickedChild([PICK, { name: 'The Weird Software License' }]);
      user = makeUser();
      const legal = mockLegalService();

      await new ModuleAnalyzer(db, company, project, module, scan, user, null, false, 'req-pick-over').analyze();

      const asked = licensesAskedAbout(legal.request, 'maven:vbo.multipart-request:multipart-request', '1.0.2');
      assert.deepEqual(asked, ['AFL-1.2'],
        'the pick must replace the unmatchable declaration, got: ' + JSON.stringify(asked));
    });

    it('leaves an ordinary dependency with no pick exactly as it was', async () => {
      // The other direction: only the marker moves anything. Without this, the tests
      // above could pass against a change that promoted every scan license on every
      // node, which is the rule 3.7.6 deliberately kept.
      db = pipelineDb([
        makeComponent('npm:host-app', ['1.0.0']),
        makeComponent('maven:vbo.multipart-request:multipart-request', [
          { version: '1.0.2', licenses: [{ key: 'Apache-2.0', name: 'Apache-2.0' }] }
        ])
      ]);
      company = makeCompany();
      project = makeProject();
      module = makeModule();
      scan = scanWithPickedChild([{ key: 'MIT', name: 'MIT' }]);
      user = makeUser();
      const legal = mockLegalService();

      await new ModuleAnalyzer(db, company, project, module, scan, user, null, false, 'req-no-pick').analyze();

      const asked = licensesAskedAbout(legal.request, 'maven:vbo.multipart-request:multipart-request', '1.0.2');
      assert.deepEqual(asked, ['Apache-2.0'],
        'an unmarked scan license on a versioned child must still be ignored, got: ' + JSON.stringify(asked));
    });
  });

  // Scan-declared licenses reach the working set in whatever shape the importer wrote
  // them. test/event_3.json - a captured production event - carries bare strings
  // ("licenses": ["MIT"]) alongside {key, name} objects, and an SBOM/CycloneDX import
  // lists every component as a TOP-LEVEL entry, so every one of them takes the root
  // branch below. Downstream Version.getLicenses assigns `selected` onto each entry,
  // which throws on a string primitive and aborted the whole analysis.
  describe('scan-declared licenses in awkward shapes', () => {
    it('accepts a bare-string license on a top-level dependency', async () => {
      db = pipelineDb([makeComponent('npm:sbom-app', ['1.0.0'])]);
      company = makeCompany();
      project = makeProject();
      module = makeModule();
      scan = makeScan([makeDependency('npm:sbom-app', '1.0.0', { licenses: ['MIT'] })]);
      user = makeUser();
      const legal = mockLegalService();

      const result = await new ModuleAnalyzer(db, company, project, module, scan, user, null, false, 'str-lic').analyze();

      assert.ok(!(result instanceof Error), 'analysis must not abort, got: ' + result);
      assert.equal(db._collections.analysis.length, 1, 'the analysis document must be saved');
      assert.deepEqual(licensesAskedAbout(legal.request, 'npm:sbom-app', '1.0.0'), ['MIT'],
        'a bare-string license must reach the check as a normalized license key');
      assert.deepEqual(licensesReportedFor(db._collections.analysis[0], 'npm:sbom-app', '1.0.0'), ['MIT'],
        'a bare-string license must be reported, not "unknown"');
    });

    it('accepts a bare-string license when the component is not in the catalogue', async () => {
      // loadComponent synthesises the record; getModuleComponents finds nothing to
      // re-read. Same crash, different branch.
      db = pipelineDb([]);
      company = makeCompany();
      project = makeProject();
      module = makeModule();
      scan = makeScan([makeDependency('npm:ghost-app', '1.0.0', { licenses: ['MIT'] })]);
      user = makeUser();
      mockLegalService();

      const result = await new ModuleAnalyzer(db, company, project, module, scan, user, null, false, 'str-lic-nocat').analyze();

      assert.ok(!(result instanceof Error), 'analysis must not abort, got: ' + result);
      assert.equal(db._collections.analysis.length, 1, 'the analysis document must be saved');
    });

    it('accepts a bare-string license on a version-less top-level dependency', async () => {
      // The dependency carries no versions, so loadComponent seeds a synthetic 0.0.0
      // and merges the scan licenses straight into declaredLicenses - the same raw
      // entries, on a second code path.
      db = pipelineDb([makeComponent('npm:no-version-app', [])]);
      company = makeCompany();
      project = makeProject();
      module = makeModule();
      scan = makeScan([{ key: 'npm:no-version-app', name: 'no-version-app', licenses: ['MIT'], dependencies: [] }]);
      user = makeUser();
      const legal = mockLegalService();

      const result = await new ModuleAnalyzer(db, company, project, module, scan, user, null, false, 'str-lic-nover').analyze();

      assert.ok(!(result instanceof Error), 'analysis must not abort, got: ' + result);
      assert.equal(db._collections.analysis.length, 1, 'the analysis document must be saved');
      assert.deepEqual(licensesAskedAbout(legal.request, 'npm:no-version-app', '0.0.0'), ['MIT'],
        'the string license must reach the check for a version-less dependency too');
    });

    it('survives falsy license entries on a top-level dependency', async () => {
      // removeEmpty deletes a falsy array element in place, leaving a hole - an array
      // that is still length 1 - so every `licenses.length` guard downstream fires on
      // a licenses list whose only entry is undefined.
      db = pipelineDb([makeComponent('npm:empty-lic-app', ['1.0.0']), makeComponent('npm:blank-lic-app', ['1.0.0'])]);
      company = makeCompany();
      project = makeProject();
      module = makeModule();
      scan = makeScan([
        makeDependency('npm:empty-lic-app', '1.0.0', { licenses: [null] }),
        makeDependency('npm:blank-lic-app', '1.0.0', { licenses: [''] })
      ]);
      user = makeUser();
      const legal = mockLegalService();

      const result = await new ModuleAnalyzer(db, company, project, module, scan, user, null, false, 'falsy-lic').analyze();

      assert.ok(!(result instanceof Error), 'analysis must not abort, got: ' + result);
      assert.equal(db._collections.analysis.length, 1, 'the analysis document must be saved');
      // Both dependencies reduce to the same (no licenses, modified, tightCoupled) entry, and
      // the check is only asked about distinct entries, so ONE empty-license entry is sent and
      // stands for both rather than one per component.
      const askedLists = Object.values((legal.request && legal.request.components) || {})
        .map((entry) => entry.licenses);
      assert.deepEqual(askedLists, [[]],
        'a falsy license entry must reach the check as an empty license list, sent once: '
        + JSON.stringify(askedLists));
      // and the answer still reaches BOTH components
      const saved = db._collections.analysis[0];
      assert.deepEqual(licensesReportedFor(saved, 'npm:empty-lic-app', '1.0.0'), ['unknown'],
        'the null-license dependency must still be reported');
      assert.deepEqual(licensesReportedFor(saved, 'npm:blank-lic-app', '1.0.0'), ['unknown'],
        'the empty-string-license dependency must still be reported');
    });

    it('does not stamp `selected` onto the scan document', async () => {
      // Version.getLicenses assigns `selected` onto every license entry it walks. The
      // working set must hold copies, not the scan's own objects, or the analysis
      // mutates its input.
      db = pipelineDb([makeComponent('npm:rt-app', ['1.0.0'])]);
      company = makeCompany();
      project = makeProject();
      module = makeModule();
      const scanLicense = { key: 'ROOT_SAMPLE', name: 'ROOT_SAMPLE' };
      scan = makeScan([makeDependency('npm:rt-app', '1.0.0', { licenses: [scanLicense] })]);
      user = makeUser();
      mockLegalService();

      await new ModuleAnalyzer(db, company, project, module, scan, user, null, false, 'no-alias').analyze();

      assert.deepEqual(scanLicense, { key: 'ROOT_SAMPLE', name: 'ROOT_SAMPLE' },
        'the scan license object must come back unmodified, got: ' + JSON.stringify(scanLicense));
    });
  });

  describe('viabilityAnalysis with real config', () => {
    it('adds viability problems for component without crawlerInfo (noInfoLevel=2)', async () => {
      const comp = makeComponent('npm:unknown-lib', ['1.0.0']);
      db = createStubDb({ components: [comp], infrastructureComponents: [] });
      company = makeCompany();
      project = makeProject();
      module = makeModule({
        viabilityConfig: { enabled: true, warningThreshold: 2, violationThreshold: 1, minConfidence: 1, noInfoLevel: 2 }
      });

      const analysis = new Analysis(company._id, module._id, false, null);
      analysis.components['npm:unknown-lib'] = {
        key: 'npm:unknown-lib', versions: [{ version: '1.0.0' }], status: 'ok'
      };

      await analysis.viabilityAnalysis(db, module, project, company);

      // noInfoLevel=2 means warnings for components without viability info
      assert.ok(analysis.statistics.viability.warnings > 0 || analysis.statistics.viability.violations > 0);
    });
  });

  describe('encryptionAnalysis with real algorithmsConfig', () => {
    it('matches mixed-case algorithm (Bcrypt in config, Bcrypt in component)', async () => {
      const comp = makeComponent('npm:crypto-lib', ['1.0.0']);
      db = createStubDb({ components: [comp], infrastructureComponents: [] });
      company = makeCompany({
        algorithmsConfig: [
          { key: 'Bcrypt', strength: '320', importStrict: [], importWeak: [], exportStrict: ['AL', 'BE'], exportWeak: [], exportIrrelevant: [] }
        ]
      });
      project = makeProject();
      module = makeModule();

      const analysis = new Analysis(company._id, module._id, false, null);
      analysis.components['npm:crypto-lib'] = {
        key: 'npm:crypto-lib',
        versions: [{ version: '1.0.0' }],
        status: 'ok',
        crypto_algorithms: [{ algorithm: 'Bcrypt' }]
      };

      await analysis.encryptionAnalysis(db, module, project, company);

      assert.ok(analysis.statistics.encryption.violations > 0,
        'should match despite mixed case');
    });

    it('flags algorithm with exportWeak as warnings', async () => {
      const comp = makeComponent('npm:crypto-lib', ['1.0.0']);
      db = createStubDb({ components: [comp], infrastructureComponents: [] });
      company = makeCompany({
        algorithmsConfig: [
          { key: 'Blowfish', strength: '128', importStrict: [], importWeak: [], exportStrict: [], exportWeak: ['US'], exportIrrelevant: [] }
        ]
      });
      project = makeProject();
      module = makeModule();

      const analysis = new Analysis(company._id, module._id, false, null);
      analysis.components['npm:crypto-lib'] = {
        key: 'npm:crypto-lib',
        versions: [{ version: '1.0.0' }],
        status: 'ok',
        crypto_algorithms: [{ algorithm: 'BLOWFISH' }]
      };

      await analysis.encryptionAnalysis(db, module, project, company);

      assert.ok(analysis.statistics.encryption.warnings > 0,
        'should match case-insensitively');
    });

    it('records correct version in encryption problem (not undefined)', async () => {
      const comp = makeComponent('npm:crypto-lib', ['2.3.1']);
      db = createStubDb({ components: [comp], infrastructureComponents: [] });
      company = makeCompany({
        algorithmsConfig: [
          { key: 'AES', strength: '256', importStrict: [], importWeak: [], exportStrict: ['CN'], exportWeak: [], exportIrrelevant: [] }
        ]
      });
      project = makeProject();
      module = makeModule();

      const analysis = new Analysis(company._id, module._id, false, null);
      analysis.components['npm:crypto-lib'] = {
        key: 'npm:crypto-lib',
        versions: [{ version: '2.3.1' }],
        status: 'ok',
        crypto_algorithms: [{ algorithm: 'aes' }]
      };

      await analysis.encryptionAnalysis(db, module, project, company);

      const problem = analysis.components['npm:crypto-lib'].problems.encryption[0];
      assert.ok(problem, 'should have encryption problem');
      assert.equal(problem.version, '2.3.1',
        'version should be the actual component version, not undefined');
    });

    it('no flags for algorithm not in config', async () => {
      const comp = makeComponent('npm:crypto-lib', ['1.0.0']);
      db = createStubDb({ components: [comp], infrastructureComponents: [] });
      company = makeCompany({
        algorithmsConfig: [
          { key: '3DES', strength: '128', importStrict: ['AE'], exportStrict: [], exportWeak: [] }
        ]
      });
      project = makeProject();
      module = makeModule();

      const analysis = new Analysis(company._id, module._id, false, null);
      analysis.components['npm:crypto-lib'] = {
        key: 'npm:crypto-lib',
        versions: [{ version: '1.0.0' }],
        status: 'ok',
        crypto_algorithms: [{ algorithm: 'AES-256' }]
      };

      await analysis.encryptionAnalysis(db, module, project, company);

      assert.equal(analysis.statistics.encryption.violations, 0);
      assert.equal(analysis.statistics.encryption.warnings, 0);
    });
  });

  describe('versioningAnalysis with real config', () => {
    it('flags major version gap with warningThreshold=3, violationThreshold=2', async () => {
      const comp = makeComponent('npm:auth-lib', ['1.0.0', '2.0.0', '3.0.0', '4.0.0', '5.0.0', '6.0.0']);
      db = createStubDb({ components: [comp], infrastructureComponents: [] });
      company = makeCompany();
      project = makeProject();
      module = makeModule({
        versioningConfig: { enabled: true, warningThreshold: 3, violationThreshold: 2 }
      });

      const analysis = new Analysis(company._id, module._id, false, null);
      analysis.components['npm:auth-lib'] = {
        key: 'npm:auth-lib', versions: [{ version: '1.0.0' }], status: 'ok', name: 'auth-lib'
      };

      await analysis.versioningAnalysis(db, module, project, company);

      // Version 1.0.0 is 6 positions behind latest → convertVersionBridge(3)=3 < 6 → warnings
      assert.ok(analysis.statistics.versioning.warnings > 0 || analysis.statistics.versioning.violations > 0);
    });
  });

  describe('endoflifeAnalysis with real config', () => {
    it('flags EOL component with module policy (warn=24, violation=12)', async () => {
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
      const comp = makeComponent('npm:mongodb', ['6.0.0'], {
        crawlerInfo: {
          endoflife: {
            info: [
              { name: '6', isEol: true, eolFrom: sixMonthsAgo.toISOString() },
              { name: '7', isEol: false }
            ]
          }
        }
      });
      db = createStubDb({ components: [comp], infrastructureComponents: [] });
      company = makeCompany();
      project = makeProject();
      module = makeModule({
        endoflifePolicy: { enabled: true, warningThreshold: 24, violationThreshold: 12 }
      });

      const analysis = new Analysis(company._id, module._id, false, null);
      analysis.components['npm:mongodb'] = {
        key: 'npm:mongodb', versions: [{ version: '6.0.0' }], status: 'ok'
      };

      await analysis.endoflifeAnalysis(db, module, project, company);

      // 6 months past EOL with violationThreshold=12 → should be warnings (not yet 12 months)
      assert.ok(
        analysis.statistics.endoflife.warnings > 0 || analysis.statistics.endoflife.violations > 0
      );
    });
  });

  describe('full pipeline with all configs enabled', () => {
    it('runs analysis with viability+versioning+endoflife enabled', async () => {
      const pastDate = new Date();
      pastDate.setMonth(pastDate.getMonth() - 3);
      const comp = makeComponent('npm:lodash', ['4.17.20', '4.17.21'], {
        declaredLicenses: [{ key: 'MIT', name: 'MIT License' }],
        crawlerInfo: {
          github: {
            status: 200,
            info: { stargazers_count: 50000, forks_count: 7000, monthlyCommitCnt: [5, 8, 3, 10, 7, 4, 6, 9, 2, 11, 5, 8, 3] }
          },
          endoflife: { info: [] }
        }
      });
      db = createStubDb({
        components: [comp],
        infrastructureComponents: [],
        cves: [],
        manualVulnerabilities: [],
        capabilities: [],
        analysis: [],
        modules: [makeModule()],
        logevents: [],
        companies: [makeCompany()],
        rules: []
      });
      company = makeCompany();
      project = makeProject();
      module = makeModule({
        viabilityConfig: { enabled: true, warningThreshold: 1, violationThreshold: 1, minConfidence: 1, noInfoLevel: 1 },
        versioningConfig: { enabled: true, warningThreshold: 3, violationThreshold: 2 },
        endoflifePolicy: { enabled: true, warningThreshold: 24, violationThreshold: 12 }
      });
      scan = makeScan([makeDependency('npm:lodash', '4.17.21')]);
      user = makeUser();

      const analyzer = new ModuleAnalyzer(db, company, project, module, scan, user, null, false, 'req-1');
      const result = await analyzer.analyzeModule();

      assert.ok(result);
      assert.ok(result.statistics);
      assert.equal(result.statistics.components, 1);
      // viability should have been evaluated
      assert.ok('viability' in result.statistics);
      // versioning should have been evaluated
      assert.ok('versioning' in result.statistics);
    });
  });

  describe('legal check unavailable (evaluateLicenses skipped)', () => {
    // When TSCheck.CheckModule fails (timeout / non-200) evaluateLicenses never rewrites
    // version.paths from raw path strings into {path, options, licenses} objects, so
    // computeStatistics sees paths without a `licenses` array. With requireWhitelist on,
    // the whitelist branch used to dereference those undefined entries and blow up with
    // "Cannot read properties of undefined (reading 'key')".
    function setupUnresolvedPaths(companyOverrides) {
      const comp = makeComponent('npm:lodash', ['4.17.21'], {
        declaredLicenses: [{ key: 'MIT', name: 'MIT License' }]
      });
      db = createStubDb({
        components: [comp],
        infrastructureComponents: [],
        cves: [],
        manualVulnerabilities: [],
        capabilities: [],
        analysis: [],
        modules: [makeModule()],
        logevents: [],
        companies: [makeCompany(companyOverrides)],
        rules: []
      });
      company = makeCompany(companyOverrides);
      project = makeProject();
      module = makeModule();
      scan = makeScan([makeDependency('npm:lodash', '4.17.21')]);
      user = makeUser();
      return new ModuleAnalyzer(db, company, project, module, scan, user, null, false, 'req-1');
    }

    it('completes the pipeline when the legal check times out and requireWhitelist is on', async () => {
      TSCheck.CheckModule = mock.fn(async () => ({ status: 504, error: 'timeout' }));
      const analyzer = setupUnresolvedPaths({ requireWhitelist: true });

      const result = await analyzer.analyzeModule();

      assert.ok(result);
      assert.equal(result.statistics.components, 1);
    });

    it('completes the pipeline when the legal check answers with an error and requireWhitelist is on', async () => {
      TSCheck.CheckModule = mock.fn(async () => ({ status: 200, error: 'result error' }));
      const analyzer = setupUnresolvedPaths({ requireWhitelist: true });

      const result = await analyzer.analyzeModule();

      assert.ok(result);
      assert.equal(result.statistics.components, 1);
    });

    it('flags the component as legally unresolved rather than silently OK', async () => {
      TSCheck.CheckModule = mock.fn(async () => ({ status: 504, error: 'timeout' }));
      const analyzer = setupUnresolvedPaths({ requireWhitelist: true });

      const result = await analyzer.analyzeModule();

      const lodash = result.components['npm:lodash'];
      assert.ok(lodash);
      assert.equal(lodash.statuses.legal, 'warnings');
    });
  });

  describe('private licenses', () => {
    // CE has no account types: a company's private licenses count for every company.
    async function legalStatus(companyOverrides) {
      // The license check rejects ACME-1.0 for this module.
      TSCheck.CheckModule = mock.fn(async (payload) => {
        const answers = {};
        for (const [componentPathKey, entry] of Object.entries(payload.components || {})) {
          answers[componentPathKey] = {};
          for (const licenseKey of entry.licenses || []) {
            answers[componentPathKey][licenseKey] = { status: 'UNSAT', obligations: [], rules: ['R1'] };
          }
        }
        return { status: 200, data: { [payload.key]: answers } };
      });
      const comp = makeComponent('npm:acme-lib', ['1.0.0'], {
        declaredLicenses: [{ key: 'ACME-1.0', name: 'ACME Proprietary 1.0' }]
      });
      db = createStubDb({
        components: [comp], infrastructureComponents: [], cves: [], manualVulnerabilities: [],
        capabilities: [], analysis: [], modules: [makeModule()], logevents: [],
        companies: [makeCompany(companyOverrides)], rules: []
      });
      company = makeCompany(companyOverrides);
      project = makeProject();
      module = makeModule();
      scan = makeScan([makeDependency('npm:acme-lib', '1.0.0')]);
      user = makeUser();
      const analyzer = new ModuleAnalyzer(db, company, project, module, scan, user, null, false, 'req-1');
      const result = await analyzer.analyzeModule();
      const found = [].concat(result.components).find(c => c && c.key === 'npm:acme-lib');
      return found.statuses.legal;
    }

    it('treats a component under a company private license as legally ok', async () => {
      const status = await legalStatus({
        accountType: undefined,
        privateLicenses: [{ key: 'ACME-1.0', name: 'ACME Proprietary 1.0' }]
      });
      assert.equal(status, 'ok');
    });

    it('still reports the violation without the private license', async () => {
      assert.equal(await legalStatus({ accountType: undefined }), 'violations');
    });
  });

  describe('infrastructure components', () => {
    it('handles im: prefix for infrastructure components', () => {
      db = createStubDb({ components: [], infrastructureComponents: [] });
      company = makeCompany();
      project = makeProject();
      module = makeModule();
      scan = makeScan([makeDependency('im:docker:latest', 'latest')]);

      const analysis = new Analysis(company._id, module._id, false, null);
      analysis.gatherComponents(db, scan, module, project, company);

      assert.equal(analysis.statistics.components, 1);
      assert.ok(analysis.components['im:docker:latest']);
    });
  });
});
