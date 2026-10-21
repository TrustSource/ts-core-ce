/* eslint-disable no-undef */
// ---------------------------------------------------------------------------
// A SARIF document names its own rules and its own tool, and both strings reach
// TrustSource as plain object keys. `Object.prototype` already answers to
// `constructor`, `toString`, `valueOf`, `hasOwnProperty` and `__proto__`, so a
// `{}` keyed on either string does not behave like an empty map:
//
//   `if (!cache[id])`            - never true for those names, so the
//                                  initialiser is skipped and the next line
//                                  operates on a function or on the prototype
//   `map[name] = ...`            - for `__proto__` this runs the prototype
//                                  setter instead of creating a property
//
// The reachable consequences, both from one authenticated upload to
// POST /api/v2/core/tests/sarif:
//
//   1. `collectRunCwes` throws `TypeError: ... is not iterable` on a rule named
//      `constructor`. The import loop had no try/catch, so a multi-run document
//      was left partially inserted with the module quality never updated.
//   2. A driver named `__proto__` wrote through to `Object.prototype`, which is
//      process-wide and outlives the request - every `for...in` in the server,
//      for every tenant, until restart.
//
// This spec pins both, plus the two smaller hostile-input defects in the same
// modules: the spread-push catalogue limit and the out-of-range CWE id.
// ---------------------------------------------------------------------------
const {loadMeteorModule} = require('../helpers/loadMeteorModule');
const runStatus = require('../../imports/lib/sarif/runStatus');
const cweExtract = require('../../imports/lib/sarif/cweExtract');
const {collectRunRuleCounts, escapeRuleId} =
  require('../../imports/lib/sarif/cweMappingOverlay');

const CREATE_JS = 'imports/lib/interactors/testImports/create.js';
const OWN_CO = 'company-own';

// Every name `Object.prototype` (or `Object` itself) already answers to.
const PROTOTYPE_NAMES = ['constructor', 'toString', 'valueOf', 'hasOwnProperty',
  '__proto__', 'isPrototypeOf', 'propertyIsEnumerable'];

// --- a run whose rule ids are prototype member names -------------------------

function hostileRun(ruleId, overrides) {
  return Object.assign({
    tool: {driver: {name: 'semgrep', rules: [
      {id: ruleId, properties: {tags: ['CWE-79: Cross-site Scripting']},
        defaultConfiguration: {level: 'error'}}
    ]}},
    results: [{ruleId: ruleId}, {ruleId: ruleId}]
  }, overrides || {});
}

// --- the import harness, same shape as sarif-import-catalog ------------------

function importer(options) {
  const opts = options || {};
  const inserted = [];
  const moduleUpdates = [];
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
      findOneAsync: async function (selector) {
        const query = typeof selector === 'string' ? {_id: selector} : selector;
        return modules.find((module) => Object.keys(query)
          .every((field) => module[field] === query[field])) || null;
      },
      updateAsync: async function (moduleId, modifier) {
        moduleUpdates.push({moduleId, modifier});
        return 1;
      }
    },
    '/imports/lib/utils': {getRunStatusCode: runStatus.getRunStatusCode},
    '/imports/lib/sarif/runStatus': runStatus,
    '/imports/lib/sarif/cweExtract': opts.cweExtract || cweExtract,
    // Run references are checked against the database; these fixtures own theirs.
    './runRefs': {runRefsBelongTo: async function () { return true; }}
  };

  return {inserted, moduleUpdates, create: loadMeteorModule(CREATE_JS, deps).default};
}

async function runImport(file, options) {
  const world = importer(options);
  const callbackArgs = [];
  await world.create({
    moduleId: 'mod-1',
    analysisId: 'an-1',
    companyId: OWN_CO,
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

// `Object.prototype` is shared with the whole Jest worker, so a leak here would
// corrupt every later spec. Fail loudly instead, and clean up either way.
const POLLUTION_PROBES = ['ok', 'warnings', 'violations', 'polluted'];

afterEach(() => {
  POLLUTION_PROBES.forEach((probe) => {
    delete Object.prototype[probe];
    delete Object[probe];
  });
});

// --- 1: cweExtract's per-rule cache -----------------------------------------

describe('#128 collectRunCwes survives a rule id that names a prototype member', () => {
  PROTOTYPE_NAMES.forEach((ruleId) => {
    it(`counts the weakness for a rule called "${ruleId}" instead of throwing`, () => {
      const run = hostileRun(ruleId);
      expect(() => cweExtract.collectRunCwes(run)).not.toThrow();
      expect(cweExtract.collectRunCwes(run)['CWE-79'])
        .toMatchObject({violations: 2, warnings: 0, notes: 0});
    });
  });

  it('NON-VACUITY: an ordinary rule id in the same fixture counts identically', () => {
    expect(cweExtract.collectRunCwes(hostileRun('py/xss'))['CWE-79'])
      .toMatchObject({violations: 2, warnings: 0, notes: 0});
  });

  it('keeps the per-rule cache working - a rule that fires twice is parsed once', () => {
    // The cache is what the prototype names broke. Prove it still caches by
    // counting how often the catalogue entry is read.
    let reads = 0;
    const rule = {id: 'constructor', defaultConfiguration: {level: 'error'}};
    Object.defineProperty(rule, 'properties', {
      enumerable: true,
      get: function () {
        reads += 1;
        return {tags: ['CWE-79']};
      }
    });
    const run = {tool: {driver: {name: 'semgrep', rules: [rule]}},
      results: [{ruleId: 'constructor'}, {ruleId: 'constructor'}, {ruleId: 'constructor'}]};

    expect(cweExtract.collectRunCwes(run)['CWE-79'].violations).toBe(3);
    // extractRuleCwes reads `properties` twice per parse (property cwe + tags),
    // so one parse is 2 reads and three parses would be 6.
    expect(reads).toBeLessThanOrEqual(2);
  });

  it('listRunCwes reports the weakness rather than blowing up', () => {
    expect(cweExtract.listRunCwes(hostileRun('valueOf'))).toEqual(['CWE-79']);
  });
});

describe('#128 collectRunRuleCounts counts a prototype-named rule as a number', () => {
  PROTOTYPE_NAMES.forEach((ruleId) => {
    it(`counts "${ruleId}" as 2, not as a coerced prototype member`, () => {
      const counts = collectRunRuleCounts(hostileRun(ruleId));
      expect(counts.violations[escapeRuleId(ruleId)]).toBe(2);
    });
  });

  it('does not leak inherited members into the buckets it hands back', () => {
    const counts = collectRunRuleCounts(hostileRun('py/xss'));
    expect(Object.keys(counts.violations)).toEqual(['py/xss']);
    expect(counts.warnings.toString).toBeUndefined();
  });
});

// --- 2: the import loop ------------------------------------------------------

describe('#128 the import counts a prototype-named rule and tool without polluting', () => {
  it('stores a numeric per-rule count for a rule called "constructor"', async () => {
    const world = await runImport({runs: [hostileRun('constructor')]});
    const doc = world.inserted[0];
    expect(doc.rules.byRule.violations.constructor).toBe(2);
    expect(doc.rules.violations).toBe(1);
    expect(runStatus.getFindingsSummary(doc.rules).total).toBe(2);
  });

  PROTOTYPE_NAMES.forEach((toolName) => {
    it(`files the quality bar under a driver named "${toolName}" without touching Object.prototype`,
      async () => {
        const run = hostileRun('py/xss');
        run.tool.driver.name = toolName;
        const world = await runImport({runs: [run]});

        expect(Object.prototype.violations).toBeUndefined();
        expect(Object.prototype.ok).toBeUndefined();
        expect(Object.violations).toBeUndefined();

        const tools = world.moduleUpdates[0].modifier.$set.quality.tools;
        expect(Object.prototype.hasOwnProperty.call(tools, toolName)).toBe(true);
        expect(tools[toolName]).toEqual({ok: 0, warnings: 0, violations: 1});
        // The value must be an own property, not the object's prototype.
        expect(Object.getPrototypeOf(tools)).not.toBe(tools[toolName]);
      });
  });

  it('keeps two prototype-named drivers apart in the same upload', async () => {
    const first = hostileRun('py/xss');
    first.tool.driver.name = '__proto__';
    const second = hostileRun('py/sqli');
    second.tool.driver.name = 'constructor';
    const world = await runImport({runs: [first, second]});

    const tools = world.moduleUpdates[0].modifier.$set.quality.tools;
    expect(Object.keys(tools).sort()).toEqual(['__proto__', 'constructor']);
    expect(Object.prototype.violations).toBeUndefined();
  });
});

describe('#128 one unimportable run does not abort the upload or half-write it', () => {
  // The failure the fix has to survive is whatever a future hostile document
  // finds next, so the failing step is injected rather than reproduced: the
  // real cweExtract is wrapped so that one marked run throws the exact
  // TypeError the prototype-keyed cache used to throw.
  function poisonedCweExtract() {
    return Object.assign({}, cweExtract, {
      collectRunCwes: function (run) {
        if (run && run.poison) {
          throw new TypeError('cwesByRuleId[severity.ruleId] is not iterable');
        }
        return cweExtract.collectRunCwes(run);
      }
    });
  }

  it('imports the good runs, skips the bad one and still records the quality bar', async () => {
    const good = hostileRun('py/xss');
    const bad = hostileRun('py/sqli', {poison: true});
    bad.tool.driver.name = 'bandit';
    const later = hostileRun('py/ssrf');
    later.tool.driver.name = 'codeql';

    const world = await runImport({runs: [good, bad, later]},
      {cweExtract: poisonedCweExtract()});

    expect(world.inserted.map((doc) => doc.tool)).toEqual(['semgrep', 'codeql']);
    expect(world.callbackArgs).toEqual([['test-1', 'test-2']]);
    expect(world.moduleUpdates).toHaveLength(1);
    expect(world.moduleUpdates[0].modifier.$set.quality.tools).toEqual({
      semgrep: {ok: 0, warnings: 0, violations: 1},
      codeql: {ok: 0, warnings: 0, violations: 1}
    });
    // Nothing from the failed run reached the database.
    expect(world.inserted.some((doc) => doc.tool === 'bandit')).toBe(false);
  });

  it('refuses the upload outright when no run could be imported at all', async () => {
    const world = importer({cweExtract: poisonedCweExtract()});
    const error = await rejection(world.create({
      moduleId: 'mod-1', companyId: OWN_CO, scanId: 'scan-1',
      file: {runs: [hostileRun('a', {poison: true}), hostileRun('b', {poison: true})]},
      type: 'sast'
    }, function () {}));

    expect(error.error).toBe(400);
    expect(world.inserted).toEqual([]);
    expect(world.moduleUpdates).toEqual([]);
  });

  it('NON-VACUITY: the same three runs all import when none of them fails', async () => {
    const world = await runImport({runs: [
      hostileRun('py/xss'), hostileRun('py/sqli'), hostileRun('py/ssrf')
    ]});
    expect(world.inserted).toHaveLength(3);
  });
});

// --- 3: the catalogue size limit --------------------------------------------

describe('#128 collectRules does not blow the stack on a very large catalogue', () => {
  function hugeExtension(count) {
    const rules = new Array(count);
    for (let i = 0; i < count; i += 1) {
      rules[i] = {id: 'rule-' + i};
    }
    return {tool: {driver: {name: 'semgrep', rules: []}, extensions: [{rules: rules}]}};
  }

  it('collects a catalogue far past the argument-count limit without throwing', () => {
    // `rules.push(...extension.rules)` throws RangeError at roughly 130k
    // arguments, which fits inside the 5 MB request body cap.
    const run = hugeExtension(200000);
    let rules;
    expect(() => {
      rules = runStatus.collectRules(run);
    }).not.toThrow();
    expect(rules.length).toBe(runStatus.MAX_CATALOG_RULES);
  });

  it('stops at the documented cap rather than at an accidental one', () => {
    expect(typeof runStatus.MAX_CATALOG_RULES).toBe('number');
    expect(runStatus.MAX_CATALOG_RULES).toBeGreaterThan(10000);
    const run = hugeExtension(runStatus.MAX_CATALOG_RULES + 10);
    expect(runStatus.collectRules(run)).toHaveLength(runStatus.MAX_CATALOG_RULES);
  });

  it('leaves an ordinary catalogue complete and in driver-first order', () => {
    const run = {tool: {driver: {rules: [{id: 'a'}]},
      extensions: [{rules: [{id: 'b'}]}, {rules: [{id: 'c'}]}]}};
    expect(runStatus.collectRules(run).map((rule) => rule.id)).toEqual(['a', 'b', 'c']);
  });
});

// --- 4: an out-of-range CWE id ----------------------------------------------

describe('#128 normalizeCwe refuses an id it cannot reprint as a CWE id', () => {
  it('rejects a number too large to survive parseInt and string concatenation', () => {
    // parseInt overflows to 1e21 and `'CWE-' + 1e21` is `CWE-1e+21`, which fails
    // the collection schema's /^CWE-\d+$/ - an opaque collection2 error where the
    // interactor meant to answer 400 "A valid CWE id is required".
    expect(cweExtract.normalizeCwe('CWE-999999999999999999999')).toBeNull();
    expect(cweExtract.normalizeCwe('CWE-12345678901234567890')).toBeNull();
    expect(cweExtract.normalizeCwe('cwe-' + '9'.repeat(400))).toBeNull();
  });

  it('never returns a string the schema regex would reject', () => {
    const inputs = ['CWE-79', 'cwe-079', 'CWE-999999999999999999999', 'CWE-0',
      'external/cwe/cwe-022', 'CWE-' + '1'.repeat(30), 'CWE-1e5', 'nonsense'];
    inputs.forEach((input) => {
      const normalized = cweExtract.normalizeCwe(input);
      if (normalized !== null) {
        expect(normalized).toMatch(/^CWE-\d+$/);
      }
    });
  });

  it('still normalises everything it accepted before', () => {
    expect(cweExtract.normalizeCwe('CWE-79')).toBe('CWE-79');
    expect(cweExtract.normalizeCwe('cwe-079')).toBe('CWE-79');
    expect(cweExtract.normalizeCwe('external/cwe/cwe-022')).toBe('CWE-22');
    expect(cweExtract.normalizeCwe('CWE-1035')).toBe('CWE-1035');
  });
});
