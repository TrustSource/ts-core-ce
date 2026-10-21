/* eslint-disable no-undef */
// ---------------------------------------------------------------------------
// The SARIF import write path, executed.
//
// What this closes.
//
// Two user-visible behaviours:
//   CodeQL uploads report their findings, not only the tool record.
//   Findings from tools that leave the severity unstated (Bandit among them)
//   are counted.
// Both live in `imports/lib/sarif/runStatus.js` (collectRules /
// resolveResultSeverity) and both reach the user through
// `imports/lib/interactors/testImports/create.js`, which is what actually writes
// rules.total, rules.byRule, rules.byCwe and the per-tool quality bar.
//
// The specs that shipped with the change exercise the two fixes only through
// `collectRunCwes`. `sarif-run-status.unit.spec.js` predates the change and was
// not extended, so `collectRules` and `resolveResultSeverity` have no direct
// tests at all, and the import path that produced the reported bug has none
// either - a regression that put `run.tool.driver.rules` back would leave every
// shipped spec green while CodeQL uploads went back to reporting zero.
//
// create.js imports Meteor, so it is loaded through `loadMeteorModule`: the real
// shipped source runs with its collections stubbed. runStatus and cweExtract are
// injected REAL - they are the code under test.
// ---------------------------------------------------------------------------
const {loadMeteorModule} = require('../helpers/loadMeteorModule');
const runStatus = require('../../imports/lib/sarif/runStatus');
const cweExtract = require('../../imports/lib/sarif/cweExtract');
const {escapeRuleId, collectRunRuleCounts} = require('../../imports/lib/sarif/cweMappingOverlay');

const CREATE_JS = 'imports/lib/interactors/testImports/create.js';
const OWN_CO = 'company-own';
const OTHER_CO = 'company-other';

function importer(options) {
  const opts = options || {};
  const inserted = [];
  const moduleUpdates = [];
  // The steady state: the module already carries a quality record from an
  // earlier scan. See the "first import" block at the bottom of this file for
  // why a module WITHOUT one behaves differently.
  const modules = opts.modules ||
    [{_id: 'mod-1', companyId: OWN_CO, quality: {scanId: 'scan-0', tools: {}}}];

  function MeteorError(error, reason) {
    this.error = error;
    this.reason = reason;
    this.message = reason + ' [' + error + ']';
  }
  MeteorError.prototype = Object.create(Error.prototype);

  const deps = {
    'meteor/meteor': {Meteor: {Error: MeteorError, isClient: false, isServer: true}},
    '/imports/lib/collections/tests': {
      insertAsync: async function (doc) {
        inserted.push(doc);
        return 'test-' + inserted.length;
      }
    },
    '/imports/lib/collections/modules': {
      findOneAsync: async function (selector, findOptions) {
        const query = typeof selector === 'string' ? {_id: selector} : selector;
        return modules.find((module) => Object.keys(query)
          .every((field) => module[field] === query[field])) || null;
      },
      updateAsync: async function (moduleId, modifier) {
        moduleUpdates.push({moduleId, modifier});
        return 1;
      }
    },
    // The real status reader behind the Utils facade - the import reads run
    // completion through it, so faking it would hide a status regression.
    '/imports/lib/utils': {getRunStatusCode: runStatus.getRunStatusCode},
    '/imports/lib/sarif/runStatus': runStatus,
    '/imports/lib/sarif/cweExtract': cweExtract,
    // Run references are checked against the database; these fixtures own theirs.
    './runRefs': {runRefsBelongTo: async function () { return true; }}
  };

  return {inserted, moduleUpdates, create: loadMeteorModule(CREATE_JS, deps).default};
}

async function runImport(file, options) {
  const world = importer(options);
  const callbackArgs = [];
  await world.create({
    moduleId: (options && 'moduleId' in options) ? options.moduleId : 'mod-1',
    analysisId: 'an-1',
    companyId: (options && options.companyId) || OWN_CO,
    scanId: 'scan-1',
    projectName: 'proj',
    moduleName: 'mod',
    file,
    type: 'sast'
  }, function (tests) {
    callbackArgs.push(tests);
  });
  return Object.assign({callbackArgs}, world);
}

async function rejection(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected the import to be refused, but it resolved');
}

// --- fixtures ---------------------------------------------------------------

// The reported CodeQL shape: `tool.driver.rules` is EMPTY and every query lives
// in a tool extension, referenced by `result.rule.{index, toolComponent.index}`
// rather than by a driver-relative `ruleIndex`.
function codeqlRun() {
  return {
    tool: {
      driver: {name: 'CodeQL', semanticVersion: '2.20.0', rules: []},
      extensions: [{
        name: 'codeql/javascript-queries',
        rules: [
          {id: 'js/xss', name: 'js/xss',
            properties: {tags: ['security', 'external/cwe/cwe-079']},
            defaultConfiguration: {level: 'error'}},
          {id: 'js/sql-injection', name: 'js/sql-injection',
            properties: {tags: ['external/cwe/cwe-089']},
            defaultConfiguration: {level: 'warning'}}
        ]
      }]
    },
    results: [
      {rule: {id: 'js/xss', index: 0, toolComponent: {index: 0}},
        message: {text: 'reflected xss'},
        locations: [{physicalLocation: {artifactLocation: {uri: 'src/a.js'}}}]},
      {ruleId: 'js/xss', rule: {id: 'js/xss', index: 0, toolComponent: {index: 0}},
        message: {text: 'reflected xss'},
        locations: [{physicalLocation: {artifactLocation: {uri: 'src/b.js'}}}]},
      {rule: {id: 'js/sql-injection', index: 1, toolComponent: {index: 0}},
        message: {text: 'sqli'},
        locations: [{physicalLocation: {artifactLocation: {uri: 'src/db.js'}}}]}
    ],
    invocations: [{executionSuccessful: true}]
  };
}

// Bandit: a real catalog, but neither the results nor the rules state a level.
// SARIF 2.1.0 (3.27.10) says a failing result with no level is a `warning`.
function banditRun() {
  return {
    tool: {
      driver: {
        name: 'Bandit',
        rules: [
          {id: 'B602', properties: {tags: ['CWE-78: OS Command Injection']},
            shortDescription: {text: 'subprocess call with shell=True'}},
          {id: 'B101', properties: {tags: ['CWE-703']}}
        ]
      }
    },
    results: [
      {ruleId: 'B602', message: {text: 'shell=True'},
        locations: [{physicalLocation: {artifactLocation: {uri: 'app/run.py'}}}]},
      {ruleId: 'B602', message: {text: 'shell=True'},
        locations: [{physicalLocation: {artifactLocation: {uri: 'app/task.py'}}}]},
      // Not a failure - `kind` is what says so, and it must stay uncounted.
      {ruleId: 'B101', kind: 'pass', message: {text: 'ok'}}
    ]
  };
}

function insertedRun(world) {
  expect(world.inserted).toHaveLength(1);
  return world.inserted[0];
}

// --- collectRules / resolveResultSeverity, directly -------------------------

describe('#126 collectRules - the catalog is driver PLUS extensions', () => {
  it('reads the queries CodeQL hosts in an extension when the driver declares none', () => {
    const rules = runStatus.collectRules(codeqlRun());
    expect(rules.map((rule) => rule.id)).toEqual(['js/xss', 'js/sql-injection']);
  });

  it('REGRESSION ANCHOR: the driver alone really does declare nothing here', () => {
    // Without this the test above could pass on a fixture that also carries
    // driver rules, and the reported bug would not be reproduced at all.
    expect(codeqlRun().tool.driver.rules).toEqual([]);
  });

  it('keeps driver entries first so an existing ruleIndex still lands correctly', () => {
    const run = codeqlRun();
    run.tool.driver.rules = [{id: 'driver/first'}];
    const rules = runStatus.collectRules(run);
    expect(rules[0].id).toBe('driver/first');
    expect(runStatus.resolveRuleForResult({ruleIndex: 0}, rules).id).toBe('driver/first');
  });

  it('concatenates several extensions and tolerates a malformed one', () => {
    const run = {tool: {driver: {rules: [{id: 'a'}]}, extensions: [
      {rules: [{id: 'b'}]}, null, {}, {rules: 'not-an-array'}, {rules: [{id: 'c'}]}
    ]}};
    expect(runStatus.collectRules(run).map((rule) => rule.id)).toEqual(['a', 'b', 'c']);
  });

  it('returns an empty catalog for a run with no tool at all', () => {
    expect(runStatus.collectRules(null)).toEqual([]);
    expect(runStatus.collectRules({})).toEqual([]);
    expect(runStatus.collectRules({tool: {}})).toEqual([]);
  });

  it('resolves an extension-hosted rule by id when only result.rule names it', () => {
    // `result.rule.index` is relative to its toolComponent, not to the flat
    // list, so the id is the only safe way in.
    const rules = runStatus.collectRules(codeqlRun());
    const result = {rule: {id: 'js/sql-injection', index: 1, toolComponent: {index: 0}}};
    expect(runStatus.resolveRuleForResult(result, rules).id).toBe('js/sql-injection');
    expect(runStatus.resolveResultSeverity(result, rules))
      .toEqual({level: 'warning', ruleId: 'js/sql-injection'});
  });
});

describe('#126 resolveResultSeverity - an unstated level is a warning, not a dropped finding', () => {
  const rules = [{id: 'B602'}, {id: 'B101', defaultConfiguration: {level: 'note'}}];

  it('defaults a failing result with no level anywhere to warning', () => {
    expect(runStatus.resolveResultSeverity({ruleId: 'B602'}, rules))
      .toEqual({level: 'warning', ruleId: 'B602'});
  });

  it('treats an absent kind as fail, which is what SARIF says it means', () => {
    expect(runStatus.resolveResultSeverity({ruleId: 'B602', kind: 'fail'}, rules))
      .toEqual({level: 'warning', ruleId: 'B602'});
  });

  it('does NOT invent a level for a result that is not a failure', () => {
    // The other direction: the default must not turn passes and notifications
    // into findings.
    expect(runStatus.resolveResultSeverity({ruleId: 'B602', kind: 'pass'}, rules)).toBeNull();
    expect(runStatus.resolveResultSeverity({ruleId: 'B602', kind: 'informational'}, rules)).toBeNull();
    expect(runStatus.resolveResultSeverity({ruleId: 'B602', kind: 'notApplicable'}, rules)).toBeNull();
  });

  it('prefers the result\'s own level, then the rule default, then the warning fallback', () => {
    expect(runStatus.resolveResultSeverity({ruleId: 'B101', level: 'error'}, rules).level).toBe('error');
    expect(runStatus.resolveResultSeverity({ruleId: 'B101'}, rules).level).toBe('note');
    expect(runStatus.resolveResultSeverity({ruleId: 'B602'}, rules).level).toBe('warning');
  });

  it('still refuses to count a result it cannot name a rule for', () => {
    // A level with no rule id has nowhere to be counted; byRule is keyed by it.
    expect(runStatus.resolveResultSeverity({level: 'error'}, rules)).toBeNull();
    expect(runStatus.resolveResultSeverity({}, [])).toBeNull();
    expect(runStatus.resolveResultSeverity(null, rules)).toBeNull();
  });
});

// --- the import path -------------------------------------------------------

describe('#126 importing a CodeQL upload counts its findings', () => {
  it('stores the extension catalog size, the per-rule counts and the weaknesses', async () => {
    const world = await runImport({runs: [codeqlRun()]});
    const doc = insertedRun(world);

    expect(doc.tool).toBe('CodeQL');
    expect(doc.status).toBe('FAILED');
    // The declared catalog, which used to be counted as 0.
    expect(doc.rules.total).toBe(2);
    // Distinct rules that fired, per level.
    expect(doc.rules.violations).toBe(1);
    expect(doc.rules.warnings).toBe(1);
    expect(doc.rules.notes).toBe(0);
    // Findings per rule - two hits of js/xss, one of js/sql-injection.
    expect(doc.rules.byRule.violations).toEqual({'js/xss': 2});
    expect(doc.rules.byRule.warnings).toEqual({'js/sql-injection': 1});
    // Which is what the UI and REST both report as the finding total.
    expect(runStatus.getFindingsSummary(doc.rules))
      .toEqual({total: 3, violations: 2, warnings: 1, notes: 0});
    // ...and the weaknesses, unpadded, each naming the rules that produced them.
    // `ruleIds` was added so the manual-assignment overlay can tell a
    // weakness the tool published for a rule from one a human assigned to the
    // same rule; the counts are what they always were.
    expect(doc.rules.byCwe).toEqual({
      'CWE-79': {violations: 2, warnings: 0, notes: 0, ruleIds: ['js/xss']},
      'CWE-89': {violations: 0, warnings: 1, notes: 0, ruleIds: ['js/sql-injection']}
    });
  });

  it('THE FIXTURE REALLY DEPENDS ON THE EXTENSION: strip it and every signal is lost', async () => {
    // The same document with its extension removed is what a regression back to
    // `run.tool.driver.rules` would see. Without this control the assertions
    // above could pass on a fixture that also carried driver rules, and the
    // reported bug would never be reproduced.
    //
    // Note what survives and what does not. The findings are still COUNTED,
    // because a sibling fix defaults an unresolvable failing result to
    // `warning` - so the "CodeQL reports zero findings" symptom is now masked by
    // that fallback even when the catalog is unreachable. What is unrecoverable
    // is everything the catalog carries: the declared rule total, the real
    // severity (the error-level rule is demoted to a warning) and every CWE.
    const stripped = codeqlRun();
    delete stripped.tool.extensions;
    const doc = insertedRun(await runImport({runs: [stripped]}));

    expect(doc.rules.total).toBe(0);
    expect(doc.rules.violations).toBe(0);
    expect(doc.rules.byRule.violations).toEqual({});
    expect(doc.rules.byRule.warnings).toEqual({'js/xss': 2, 'js/sql-injection': 1});
    expect(doc.rules.byCwe).toEqual({});
    // ...against the intact document, where all three come out right.
    const intact = insertedRun(await runImport({runs: [codeqlRun()]}));
    expect(intact.rules.total).toBe(2);
    expect(intact.rules.byRule.violations).toEqual({'js/xss': 2});
    expect(Object.keys(intact.rules.byCwe).sort()).toEqual(['CWE-79', 'CWE-89']);
  });

  it('counts the run as one violation unit on the per-tool quality bar', async () => {
    const world = await runImport({runs: [codeqlRun()]});
    expect(world.moduleUpdates).toHaveLength(1);
    expect(world.moduleUpdates[0].modifier.$set.quality.tools).toEqual({
      CodeQL: {ok: 0, warnings: 0, violations: 1}
    });
  });
});

describe('#126 importing a Bandit upload keeps its unstated-severity findings', () => {
  it('counts them as warnings instead of dropping them', async () => {
    const world = await runImport({runs: [banditRun()]});
    const doc = insertedRun(world);

    expect(doc.rules.byRule.warnings).toEqual({B602: 2});
    expect(doc.rules.byRule.violations).toEqual({});
    expect(doc.rules.byRule.notes).toEqual({});
    expect(runStatus.getFindingsSummary(doc.rules))
      .toEqual({total: 2, violations: 0, warnings: 2, notes: 0});
    expect(doc.rules.byCwe)
      .toEqual({'CWE-78': {violations: 0, warnings: 2, notes: 0, ruleIds: ['B602']}});
  });

  it('leaves the passing result uncounted, in the counts and in the weaknesses', async () => {
    // Both directions in one document: the failures are counted, the pass is not
    // - so the warning default cannot be turning everything into a finding.
    const world = await runImport({runs: [banditRun()]});
    const doc = insertedRun(world);
    expect(doc.rules.byRule.warnings.B101).toBeUndefined();
    expect(doc.rules.byCwe['CWE-703']).toBeUndefined();
    expect(doc.rules.total).toBe(2);
  });

  it('puts the run in the warnings segment of the quality bar, not violations', async () => {
    const world = await runImport({runs: [banditRun()]});
    expect(world.moduleUpdates[0].modifier.$set.quality.tools)
      .toEqual({Bandit: {ok: 0, warnings: 1, violations: 0}});
  });

  it('counts a genuinely clean run as ok', async () => {
    const clean = {tool: {driver: {name: 'Bandit', rules: [{id: 'B602'}]}}, results: [],
      invocations: [{executionSuccessful: true}]};
    const world = await runImport({runs: [clean]});
    expect(insertedRun(world).status).toBe('PASSED');
    expect(world.moduleUpdates[0].modifier.$set.quality.tools)
      .toEqual({Bandit: {ok: 1, warnings: 0, violations: 0}});
  });
});

// --- the seam the CWE overlay depends on ----------------------------------

describe('#112 the stored rule-id keys are exactly what the overlay looks up', () => {
  const semgrepRun = {
    tool: {driver: {name: 'semgrep', rules: [
      {id: 'python.lang.security.audit.eval-detected', defaultConfiguration: {level: 'error'}},
      {id: '$special.rule', defaultConfiguration: {level: 'note'}}
    ]}},
    results: [
      {ruleId: 'python.lang.security.audit.eval-detected'},
      {ruleId: 'python.lang.security.audit.eval-detected'},
      {ruleId: '$special.rule'}
    ]
  };

  it('escapes dotted and $-prefixed ids the way Mongo requires', async () => {
    const doc = insertedRun(await runImport({runs: [semgrepRun]}));
    expect(Object.keys(doc.rules.byRule.violations))
      .toEqual(['python___lang___security___audit___eval-detected']);
    expect(Object.keys(doc.rules.byRule.notes)).toEqual(['_dollar_special___rule']);
  });

  it('produces the same keys the overlay escapes a raw rule id into', async () => {
    // The whole manual-assignment feature rests on these two escapings being the
    // same function. They live in different files, so pin them together.
    const doc = insertedRun(await runImport({runs: [semgrepRun]}));
    expect(Object.keys(doc.rules.byRule.violations))
      .toContain(escapeRuleId('python.lang.security.audit.eval-detected'));
    expect(Object.keys(doc.rules.byRule.notes)).toContain(escapeRuleId('$special.rule'));
  });

  it('agrees with collectRunRuleCounts, which the findings page uses instead', async () => {
    // The findings page has the parsed run and not the stored counts. If the two
    // ever disagree, an assignment would light up in one view and not the other.
    const doc = insertedRun(await runImport({runs: [semgrepRun]}));
    expect(collectRunRuleCounts(semgrepRun)).toEqual(doc.rules.byRule);
  });

  it('keeps every stored weakness key usable as a Mongo field name', async () => {
    // byCwe is deliberately NOT escaped, on the grounds that a CWE id has no
    // character Mongo objects to. Assert that rather than trusting it.
    const doc = insertedRun(await runImport({runs: [codeqlRun()]}));
    Object.keys(doc.rules.byCwe).forEach((key) => {
      expect(key).toMatch(/^CWE-\d+$/);
      expect(key).not.toContain('.');
      expect(key.startsWith('$')).toBe(false);
    });
  });
});

// --- tenancy and degenerate input ------------------------------------------

describe('the import refuses to attach a test to another company\'s module', () => {
  it('throws 403 and inserts nothing for a module owned elsewhere', async () => {
    const world = importer({modules: [{_id: 'mod-1', companyId: OTHER_CO}]});
    const error = await rejection(world.create({
      moduleId: 'mod-1', companyId: OWN_CO, file: {runs: [codeqlRun()]}, type: 'sast'
    }, function () {}));

    expect(error.error).toBe(403);
    expect(world.inserted).toEqual([]);
    expect(world.moduleUpdates).toEqual([]);
  });

  it('NON-VACUITY: the same import against its own module does insert', async () => {
    const world = await runImport({runs: [codeqlRun()]});
    expect(world.inserted).toHaveLength(1);
    expect(world.inserted[0].companyId).toBe(OWN_CO);
  });

  it('refuses a document with no runs', async () => {
    const world = importer();
    const error = await rejection(world.create({
      moduleId: 'mod-1', companyId: OWN_CO, file: {runs: []}, type: 'sast'
    }, function () {}));
    expect(error.error).toBe(400);
    expect(world.inserted).toEqual([]);
  });

  it('imports every run in a multi-run document and reports each test id', async () => {
    const world = await runImport({runs: [codeqlRun(), banditRun()]});
    expect(world.inserted.map((doc) => doc.tool)).toEqual(['CodeQL', 'Bandit']);
    expect(world.callbackArgs).toEqual([['test-1', 'test-2']]);
    expect(world.moduleUpdates[0].modifier.$set.quality.tools).toEqual({
      CodeQL: {ok: 0, warnings: 0, violations: 1},
      Bandit: {ok: 0, warnings: 1, violations: 0}
    });
  });

  it('survives a run whose results reference rules the catalog does not declare', async () => {
    const orphan = {tool: {driver: {name: 'mystery', rules: []}},
      results: [{ruleId: 'unknown.rule'}, {message: {text: 'no rule at all'}}]};
    const doc = insertedRun(await runImport({runs: [orphan]}));

    // The named rule still counts (warning by default); the anonymous one cannot.
    expect(doc.rules.byRule.warnings).toEqual({'unknown___rule': 1});
    expect(runStatus.getFindingsSummary(doc.rules).total).toBe(1);
    expect(doc.rules.byCwe).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// PRE-EXISTING DEFECT, pinned rather than fixed.
//
// The quality branch in create.js reads:
//
//   if (!scanId || (module && module.quality && !module.quality.scanId)
//                || (module && module.quality && module.quality.scanId !== scanId)) { ... }
//   else if (module && module.quality && module.quality.scanId === scanId) { ... }
//   await Modules.updateAsync(moduleId, {$set: {quality: quality}});
//
// Every branch that BUILDS a quality object requires `module.quality` to already
// exist, unless `scanId` is falsy. So for a module that has never carried one -
// which is every module on its first import - an import that DOES carry a scanId
// falls through both branches with `quality` still `undefined`, and the update
// writes that. The scanId-carrying path is the CI/scan-ingest path
// (imports/server/rest-api/tests.js passes scanId whenever the request has one),
// so the per-tool quality bar is never populated by a module's first scan.
//
// This block is NOT in the audited commit range: `git show d12442e27~1` has the
// identical branch, and `git log -L` puts it at 3.2.50 or earlier. It is
// recorded here because these tests are the first thing to execute the branch;
// the assertion describes what the shipped code DOES, so a fix will fail it
// loudly rather than passing silently.
// ---------------------------------------------------------------------------
describe('PRE-EXISTING: a module with no prior quality record gets none from a scan import', () => {
  const FRESH = [{_id: 'mod-1', companyId: OWN_CO}];

  it('writes quality: undefined when scanId is present and module.quality is not', async () => {
    const world = await runImport({runs: [codeqlRun()]}, {modules: FRESH});
    expect(world.inserted).toHaveLength(1);
    expect(world.moduleUpdates).toHaveLength(1);
    // What the shipped code does today. Not what it should do.
    expect(world.moduleUpdates[0].modifier).toEqual({$set: {quality: undefined}});
    expect(world.moduleUpdates[0].modifier.$set.quality).toBeUndefined();
  });

  it('CONTRAST: the same import with no scanId does record the quality bar', async () => {
    const world = importer({modules: FRESH});
    await world.create({
      moduleId: 'mod-1', companyId: OWN_CO, file: {runs: [codeqlRun()]}, type: 'sast'
    }, function () {});
    expect(world.moduleUpdates[0].modifier.$set.quality)
      .toEqual({tools: {CodeQL: {ok: 0, warnings: 0, violations: 1}}});
  });

  it('CONTRAST: once a quality record exists, a scan import updates it normally', async () => {
    const world = await runImport({runs: [codeqlRun()]},
      {modules: [{_id: 'mod-1', companyId: OWN_CO, quality: {scanId: 'scan-0', tools: {}}}]});
    expect(world.moduleUpdates[0].modifier.$set.quality).toEqual({
      scanId: 'scan-1', tools: {CodeQL: {ok: 0, warnings: 0, violations: 1}}
    });
  });
});
