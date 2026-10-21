import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createStubDb } from '../helpers/stubDb.js';
import { makeCompany, makeProject, makeModule, makeScan, makeDependency, makeUser, makeComponent } from '../helpers/fixtures.js';
import { Analysis, ModuleAnalyzer } from '../../../analysis/services/ModuleAnalyzer.js';
import { TSCheck } from '../../../analysis/services/TSCheck.js';

// ts-app
//
// A scan may carry a dependency node with neither `key` nor `purl`. ts-app cannot look a
// component up for it, so since ts-app 3.2.69 it records the node in the scan's
// `skippedDependencies` and - deliberately - LEAVES IT IN THE STORED TREE, so the loss
// stays visible and `dependencyCount` stays honest. This service reads that stored tree.
//
// One such node used to cost the whole module its analysis, because `loadComponent` calls
// `key.indexOf('im:')` on the undefined key. It reached there two ways. gatherComponents
// tests the PROMISE getComponent returns, and a promise is truthy, so the node was entered
// into the working set under an undefined key - and the next phase to walk that set
// (eachComponent, in encryptionAnalysis) handed the undefined key back and threw, which is
// the path these tests reproduce: caught, logged, no analysis document written. In
// legalAnalysis the same TypeError has no handler at all, because eachDependency is
// synchronous and never awaits its async callback - an unhandled rejection, which is what
// ends a Lambda invocation with "Runtime exited with error: exit status 1", the symptom
// that was reported. Either way: twenty valid dependencies next to one unidentifiable
// one produced zero analysis documents.
//
// A node this service cannot identify is now skipped, exactly like a node ts-app could
// not identify: it contributes no component and no license, and everything around it -
// its siblings, its children, the rest of the tree - is analysed as usual.

function mockTSCheck() {
  TSCheck.CheckModule = mock.fn(async () => ({ status: 200, data: {} }));
}

// A DB seeded with every collection the full analyze() pipeline touches.
function pipelineDb(components) {
  return createStubDb({
    components,
    infrastructureComponents: [],
    cves: [], manualVulnerabilities: [], capabilities: [], analysis: [],
    modules: [makeModule()], logevents: [], companies: [makeCompany()], rules: []
  });
}

// The node ts-app could not identify: a name and a version, but nothing to look a
// component up by. Same shape as the payload in ts-app's scan-crash-isolation spec.
function keylessDependency(name, opts = {}) {
  return {
    name,
    private: false,
    licenses: [],
    versions: ['1.0.0'],
    dependencies: opts.dependencies || [],
    ...opts
  };
}

const componentKeys = (saved) => (saved.components || []).map(c => c.key);

describe('Integration: a dependency with neither key nor purl (ts-app#135)', () => {
  let db, company, project, module, scan, user;

  beforeEach(() => {
    mockTSCheck();
    company = makeCompany();
    project = makeProject();
    module = makeModule();
    user = makeUser();
  });

  it('analyses the valid siblings instead of failing the whole run', async () => {
    const keys = Array.from({ length: 20 }, (_, i) => `npm:ok-${i}`);
    db = pipelineDb(keys.map(key => makeComponent(key, ['1.0.0'])));
    const deps = keys.map(key => makeDependency(key, '1.0.0'));
    deps.splice(10, 0, keylessDependency('iso-bad'));
    scan = makeScan(deps);

    await new ModuleAnalyzer(db, company, project, module, scan, user, null, false, 'kl-1').analyze();

    const saved = db._collections.analysis[0];
    assert.ok(saved, 'the run must produce an analysis document');
    assert.deepEqual(componentKeys(saved).sort(), keys.slice().sort());
  });

  it('leaves no phantom component behind for the node it skipped', async () => {
    db = pipelineDb([makeComponent('npm:ok', ['1.0.0'])]);
    scan = makeScan([makeDependency('npm:ok', '1.0.0'), keylessDependency('iso-bad')]);

    await new ModuleAnalyzer(db, company, project, module, scan, user, null, false, 'kl-2').analyze();

    const saved = db._collections.analysis[0];
    // The skipped node must not reach the analysis under an empty key, and must not be
    // counted as a component the module has.
    assert.deepEqual(componentKeys(saved), ['npm:ok']);
    for (const key of componentKeys(saved)) {
      assert.ok(typeof key === 'string' && key.length > 0, 'component key must be a real key, got: ' + JSON.stringify(key));
    }
    assert.equal(saved.statistics.components, 1);
  });

  it('still analyses the children of the node it skipped', async () => {
    const childKeys = ['npm:kid-a', 'npm:kid-b'];
    db = pipelineDb(childKeys.map(key => makeComponent(key, ['1.0.0'])));
    scan = makeScan([keylessDependency('iso-orphan', {
      dependencies: childKeys.map(key => makeDependency(key, '1.0.0'))
    })]);

    await new ModuleAnalyzer(db, company, project, module, scan, user, null, false, 'kl-3').analyze();

    const saved = db._collections.analysis[0];
    assert.deepEqual(componentKeys(saved).sort(), childKeys.slice().sort());
  });

  it('skips such a node nested deep in the tree, not just at the root', async () => {
    const keys = ['npm:top', 'npm:leaf'];
    db = pipelineDb(keys.map(key => makeComponent(key, ['1.0.0'])));
    scan = makeScan([makeDependency('npm:top', '1.0.0', {
      dependencies: [keylessDependency('iso-bad-child', {
        dependencies: [makeDependency('npm:leaf', '1.0.0')]
      })]
    })]);

    await new ModuleAnalyzer(db, company, project, module, scan, user, null, false, 'kl-4').analyze();

    const saved = db._collections.analysis[0];
    assert.deepEqual(componentKeys(saved).sort(), keys.slice().sort());
  });

  it('skips a keyless entry in the module custom components', async () => {
    db = pipelineDb([makeComponent('npm:custom-ok', ['1.0.0'])]);
    module = makeModule({
      customComponents: [makeDependency('npm:custom-ok', '1.0.0'), keylessDependency('custom-bad')]
    });
    scan = makeScan([]);

    await new ModuleAnalyzer(db, company, project, module, scan, user, null, false, 'kl-5').analyze();

    const saved = db._collections.analysis[0];
    assert.deepEqual(componentKeys(saved), ['npm:custom-ok']);
  });

  it('reports the licenses of the valid components (legalAnalysis reaches them)', async () => {
    db = pipelineDb([makeComponent('npm:ok', ['1.0.0'], {
      declaredLicenses: [{ key: 'MIT', name: 'MIT' }]
    })]);
    scan = makeScan([makeDependency('npm:ok', '1.0.0'), keylessDependency('iso-bad')]);

    await new ModuleAnalyzer(db, company, project, module, scan, user, null, false, 'kl-6').analyze();

    const saved = db._collections.analysis[0];
    assert.ok((saved.licenses || []).map(l => l.key).includes('MIT'),
      'the valid component keeps its license, got: ' + JSON.stringify((saved.licenses || []).map(l => l.key)));
  });

  describe('getComponent / loadComponent', () => {
    it('answers null for a key that is not a usable string, without touching the DB', async () => {
      db = pipelineDb([]);
      const analysis = new Analysis('COMPANY_1', 'MODULE_1', false, null);

      for (const key of [undefined, null, '']) {
        assert.equal(await analysis.getComponent(db, key, makeModule(), false, { name: 'x' }),
          null, 'expected null for key ' + JSON.stringify(key));
      }
    });

    it('does not poison the component cache with an unusable key', async () => {
      db = pipelineDb([]);
      const analysis = new Analysis('COMPANY_1', 'MODULE_1', false, null);

      await analysis.getComponent(db, undefined, makeModule(), false, { name: 'x' });

      assert.deepEqual(Object.keys(analysis.componentCache), []);
    });
  });
});
