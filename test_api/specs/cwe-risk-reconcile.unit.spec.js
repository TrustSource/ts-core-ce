/* eslint-disable no-undef */
// ---------------------------------------------------------------------------
// The SARIF -> risk-register WRITER, executed rather than described.
//
// WHAT THIS CLOSES
//
// `imports/lib/interactors/riskProperties/reconcileFromSarif.js` is where every
// acceptance criterion about writing actually happens - the gate chain (AC1,
// AC5, AC29; the former AC4 feature-licence gate is gone in the Community
// Edition, where every company has every feature), the no-write short-circuit
// the user asked for above
// everything else (AC15/AC21), the duplicate-key fall-through that makes two
// concurrent imports safe (AC18), the states an import must not touch (AC26)
// and the ones it must refresh (AC27), the stale sweep (AC24) and the per-risk
// failure isolation (AC30). It shipped with NO executable test at all: the four
// backend suites cover the pure planner and the pure change detection, and
// `cwe-risk-wiring.source.unit.spec.js` asserts on its source TEXT. A source
// assertion cannot tell you that the gates run in the right order, that the
// unchanged branch really performs no updateAsync, or that the sweep reaches a
// risk the newest scan no longer mentions.
//
// So the real shipped source is loaded through the repo's `loadMeteorModule`
// helper: its imports are swapped for recording stand-ins and the file is
// evaluated in a vm. What is faked is Mongo and Meteor - the collaborators.
// What is injected REAL is every decision module: `cweRiskPlan.js` (planner and
// change detection) and `managedFields.js` (UNTOUCHED_RISK_STATES). A spec-local
// copy of either would turn this into a test of the copy.
//
// The helper throws when an import has no stand-in, so adding a dependency to
// the interactor fails this suite loudly instead of silently binding undefined.
//
// SARIF fixtures are the shapes the tools really emit - the ones
// sarif-cwe-extract.unit.spec.js lifted out of real CodeQL / semgrep / Bandit
// documents. Nothing here is an invented SARIF shape.
// ---------------------------------------------------------------------------
const {loadMeteorModule} = require('../helpers/loadMeteorModule');
const plan = require('../../imports/lib/sarif/cweRiskPlan');
const managedFields = require('../../imports/lib/interactors/riskProperties/managedFields');

const RECONCILE_JS = 'imports/lib/interactors/riskProperties/reconcileFromSarif.js';

const CO = 'company-owner';
const OTHER_CO = 'company-other';
const MODULE = 'mod1111111111111';
const PROJECT = 'prj1111111111111';
const ACTOR = {_id: 'user-1', profile: {companyId: CO, name: 'Sec Manager'},
  emails: [{address: 'sec@owner.example'}]};

// --- SARIF fixtures --------------------------------------------------------
// semgrep publishes its weaknesses in properties.cwe (newer OSS) and in
// properties.tags (older builds); CodeQL uses the external/cwe/cwe-nnn tag form.
const XSS_RULE = {
  id: 'javascript.express.security.audit.xss.direct-response-write',
  properties: {cwe: ['CWE-79: Improper Neutralization of Input During Web Page Generation']},
  defaultConfiguration: {level: 'error'}
};
const SHELL_RULE = {
  id: 'python.lang.security.audit.subprocess-shell-true',
  properties: {tags: ['CWE-78: OS Command Injection', 'OWASP-A03:2021 - Injection']},
  defaultConfiguration: {level: 'warning'}
};
// Bandit ships rules with no weakness at all - B104 really carries only a helpUri.
const NO_CWE_RULE = {
  id: 'B104',
  helpUri: 'https://bandit.readthedocs.io/en/1.7.4/plugins/b104.html'
};

function at(ruleId, uri) {
  return {ruleId, locations: [{physicalLocation: {artifactLocation: {uri}}}]};
}

function run(driver, rules, results) {
  return {tool: {driver: {name: driver, rules}}, results};
}

const SEMGREP_RUN = run('semgrep', [XSS_RULE, SHELL_RULE], [
  at(XSS_RULE.id, 'src/app/render.js'),
  at(XSS_RULE.id, 'src/app/render.js'),
  at(XSS_RULE.id, 'src/app/reply.js'),
  at(SHELL_RULE.id, 'tools/deploy.py')
]);
// The same tool, one scan later: the reply.js finding is fixed and CWE-78 is
// gone from the document entirely.
const SEMGREP_RUN_FEWER = run('semgrep', [XSS_RULE], [
  at(XSS_RULE.id, 'src/app/render.js'),
  at(XSS_RULE.id, 'src/app/render.js')
]);
// The same tool reporting a completely clean scan: rules ran, nothing with a
// weakness fired. This is the "everything got fixed" case AC24 is really about.
const SEMGREP_RUN_CLEAN = run('semgrep', [NO_CWE_RULE], [at(NO_CWE_RULE.id, 'app.py')]);

function testDoc(id, sarifRun, overrides) {
  return Object.assign({
    _id: id,
    companyId: CO,
    moduleId: MODULE,
    type: 'SARIF',
    tool: sarifRun && sarifRun.tool.driver.name,
    data: JSON.stringify(sarifRun)
  }, overrides || {});
}

// --- an in-memory Mongo good enough for the selectors this interactor builds --

function valueAt(doc, path) {
  return path.split('.').reduce(function (node, key) {
    return node === null || node === undefined ? undefined : node[key];
  }, doc);
}

function matchValue(actual, wanted) {
  if (wanted && typeof wanted === 'object' && !Array.isArray(wanted)) {
    if (Array.isArray(wanted.$in)) {
      return wanted.$in.indexOf(actual) !== -1;
    }
    if (Array.isArray(wanted.$nin)) {
      // Mongo's $nin also matches a document that has no such field at all -
      // which is exactly why the stale sweep has to carry `autoTool` as well,
      // or it would sweep every hand-made risk on the module.
      return wanted.$nin.indexOf(actual) === -1;
    }
    throw new Error('unsupported selector operator: ' + JSON.stringify(wanted));
  }
  return actual === wanted;
}

function matchSelector(doc, selector) {
  if (typeof selector === 'string') {
    return doc._id === selector;
  }
  return Object.keys(selector).every(function (field) {
    return matchValue(valueAt(doc, field), selector[field]);
  });
}

// A dotted INCLUSION projection, applied for real. The interactor reads
// `riskProperties.state` and `riskProperties.sourceRefs*` off what comes back,
// so a field missing from its PROJECTION would silently read as undefined and
// (for `state`) turn AC26 into "writes to every risk". Faking the projection away
// would hide that.
function project(doc, options) {
  const fields = options && options.fields;
  if (!fields) {
    return JSON.parse(JSON.stringify(doc));
  }
  const out = {_id: doc._id};
  Object.keys(fields).forEach(function (path) {
    if (!fields[path] || path === '_id') {
      return;
    }
    const value = valueAt(doc, path);
    if (value === undefined) {
      return;
    }
    const segments = path.split('.');
    let node = out;
    segments.slice(0, -1).forEach(function (key) {
      if (!node[key]) {
        node[key] = {};
      }
      node = node[key];
    });
    node[segments[segments.length - 1]] =
      value && typeof value === 'object' ? JSON.parse(JSON.stringify(value)) : value;
  });
  return out;
}

function applyModifier(doc, modifier) {
  Object.keys(modifier.$set || {}).forEach(function (path) {
    const segments = path.split('.');
    let node = doc;
    segments.slice(0, -1).forEach(function (key) {
      if (!node[key]) {
        node[key] = {};
      }
      node = node[key];
    });
    node[segments[segments.length - 1]] = modifier.$set[path];
  });
  Object.keys(modifier.$unset || {}).forEach(function (path) {
    const segments = path.split('.');
    let node = doc;
    for (let i = 0; i < segments.length - 1; i += 1) {
      node = node && node[segments[i]];
    }
    if (node) {
      delete node[segments[segments.length - 1]];
    }
  });
}

/**
 * One reconcile world.
 *
 *   module / project              the gate chain's two documents (null = absent)
 *   tests                        stored Tests documents
 *   risks                        pre-existing riskProperties documents
 *   user                         the DDP caller (null = signed out)
 *   blindFindOne                 make the next N RiskProperties.findOneAsync
 *                                calls miss while the document is really there -
 *                                the concurrent-import race AC18 is about
 *   insertFails                  autoKey -> Error thrown by insertAsync
 */
function world(options) {
  const opts = options || {};
  const log = [];
  const events = [];
  const risks = (opts.risks || []).map(function (doc) { return JSON.parse(JSON.stringify(doc)); });
  let blind = opts.blindFindOne || 0;
  let nextId = 0;

  function MeteorError(error, reason) {
    this.error = error;
    this.reason = reason;
    this.message = reason + ' [' + error + ']';
  }
  MeteorError.prototype = Object.create(Error.prototype);
  MeteorError.prototype.name = 'Meteor.Error';

  function reader(name, docs) {
    return {
      findOneAsync: async function (selector, findOptions) {
        log.push({collection: name, op: 'findOne', selector});
        const hit = docs.find(function (doc) { return matchSelector(doc, selector); });
        return hit ? project(hit, findOptions) : null;
      },
      find: function (selector, findOptions) {
        log.push({collection: name, op: 'find', selector, options: findOptions});
        return {
          fetch: function () {
            throw new Error(name + '.find().fetch() is client-only in Meteor 3 - use fetchAsync()');
          },
          fetchAsync: async function () {
            const hits = docs.filter(function (doc) { return matchSelector(doc, selector); });
            const limit = findOptions && findOptions.limit;
            return (limit ? hits.slice(0, limit) : hits)
              .map(function (doc) { return project(doc, findOptions); });
          }
        };
      }
    };
  }

  const RiskProperties = Object.assign(reader('riskProperties', risks), {
    findOneAsync: async function (selector, findOptions) {
      log.push({collection: 'riskProperties', op: 'findOne', selector});
      const hit = risks.find(function (doc) { return matchSelector(doc, selector); });
      if (blind > 0) {
        blind -= 1;
        return null;
      }
      return hit ? project(hit, findOptions) : null;
    },
    insertAsync: async function (doc) {
      log.push({collection: 'riskProperties', op: 'insert', doc: JSON.parse(JSON.stringify(doc))});
      const autoKey = valueAt(doc, 'riskProperties.autoKey');
      if (opts.insertFails && opts.insertFails[autoKey]) {
        throw opts.insertFails[autoKey];
      }
      // The shipped unique PARTIAL index: unique over
      // {companyId, riskProperties.autoKey}, filtered to documents that have an
      // autoKey - so any number of hand-made risks with no autoKey coexist
      // (AC20) while a second auto risk for the same key in the same company is
      // impossible (AC18). COMPOUND, matching server/collections/
      // riskProperties.js: a globally unique key would let a row planted in one
      // company refuse another company's insert for ever.
      if (autoKey !== undefined && risks.some(function (stored) {
        return valueAt(stored, 'riskProperties.autoKey') === autoKey &&
          stored.companyId === doc.companyId;
      })) {
        const error = new Error('E11000 duplicate key error collection: ts.riskProperties ' +
          'index: riskProperties_autoKey_unique');
        error.code = 11000;
        throw error;
      }
      nextId += 1;
      const stored = Object.assign({_id: 'risk-new-' + nextId}, JSON.parse(JSON.stringify(doc)));
      risks.push(stored);
      return stored._id;
    },
    updateAsync: async function (selector, modifier) {
      log.push({collection: 'riskProperties', op: 'update', selector,
        modifier: JSON.parse(JSON.stringify(modifier))});
      const hits = risks.filter(function (doc) { return matchSelector(doc, selector); });
      hits.forEach(function (doc) { applyModifier(doc, modifier); });
      return hits.length;
    }
  });

  const Meteor = {
    Error: MeteorError,
    isClient: false,
    isServer: true,
    userAsync: async function () {
      return Object.prototype.hasOwnProperty.call(opts, 'user') ? opts.user : ACTOR;
    },
    callAsync: async function (name) {
      events.push({name, args: Array.prototype.slice.call(arguments, 1)});
      return null;
    }
  };

  const deps = {
    'meteor/meteor': {Meteor},
    '/imports/lib/collections/riskProperties': RiskProperties,
    '/imports/lib/collections/modules': reader('modules',
      Object.prototype.hasOwnProperty.call(opts, 'module') ?
        [].concat(opts.module || []) :
        [{_id: MODULE, companyId: CO, projectId: PROJECT}]),
    '/imports/lib/collections/projects': reader('projects',
      Object.prototype.hasOwnProperty.call(opts, 'project') ?
        [].concat(opts.project || []) :
        [{_id: PROJECT, companyId: CO, autoCreateCweRisks: true}]),
    '/imports/lib/collections/tests': reader('tests', opts.tests || []),
    '/imports/lib/user/displayName': {userDisplayName: function (user) {
      return (user && user.profile && user.profile.name) || 'unknown';
    }},
    // REAL, not faked: these hold every decision the writer delegates.
    '/imports/lib/sarif/cweRiskPlan': plan,
    './managedFields': managedFields
  };

  return {
    log,
    events,
    risks,
    writes: function () {
      return log.filter(function (entry) {
        return entry.op === 'insert' || entry.op === 'update';
      });
    },
    reconcile: loadMeteorModule(RECONCILE_JS, deps).default
  };
}

function riskByKey(risks, autoKey) {
  return risks.find(function (doc) {
    return doc.riskProperties && doc.riskProperties.autoKey === autoKey;
  }) || null;
}

function keyFor(cwe, tool) {
  return 'sarif-cwe|' + MODULE + '|' + (tool || 'semgrep') + '|' + cwe;
}

// A stored risk exactly as insertRisk would have left it after the SEMGREP_RUN
// import above, so a spec can start from "already imported once".
function storedRisk(overrides) {
  return Object.assign({
    _id: 'risk-xss',
    created: new Date('2026-01-01T00:00:00Z'),
    userId: ACTOR._id,
    userName: 'Sec Manager',
    companyId: CO,
    projectId: PROJECT,
    moduleId: MODULE,
    name: '[CWE-79] Weakness reported by semgrep',
    riskProperties: {
      state: 'identified',
      origin: ['CWE'],
      autoKey: keyFor('CWE-79'),
      autoTool: 'semgrep',
      autoCwe: 'CWE-79',
      sourceRefs: [
        {tool: 'semgrep', ruleId: XSS_RULE.id, uri: 'src/app/render.js', level: 'error', count: 2},
        {tool: 'semgrep', ruleId: XSS_RULE.id, uri: 'src/app/reply.js', level: 'error', count: 1}
      ],
      sourceRefsTotal: 2,
      sourceRefsTruncated: false,
      threatModelContext: {cwes: ['CWE-79']}
    }
  }, overrides || {});
}

function withState(state) {
  const doc = storedRisk();
  doc.riskProperties.state = state;
  return doc;
}

// =============================================================================
// Step 0 - argument bounds, before any work proportional to the input.
// =============================================================================

describe('#129 reconcileFromSarif - argument bounds run before any query', () => {
  const CASES = [
    ['a missing moduleId', {testIds: ['t1']}],
    ['a non-string moduleId', {moduleId: {$ne: ''}, testIds: ['t1']}],
    ['an empty moduleId', {moduleId: '', testIds: ['t1']}],
    ['an over-long moduleId', {moduleId: 'x'.repeat(65), testIds: ['t1']}],
    ['testIds that is not an array', {moduleId: MODULE, testIds: 't1'}],
    ['testIds that is a selector object', {moduleId: MODULE, testIds: {$ne: null}}],
    ['a non-string id in the list', {moduleId: MODULE, testIds: ['t1', 42]}],
    ['an operator object in the list', {moduleId: MODULE, testIds: [{$ne: ''}]}],
    ['a null in the list', {moduleId: MODULE, testIds: [null]}],
    ['an over-long id in the list', {moduleId: MODULE, testIds: ['x'.repeat(65)]}],
    ['more ids than the cap', {moduleId: MODULE,
      testIds: new Array(plan.SARIF_RECONCILE_MAX_TESTS + 1).fill('t')}]
  ];

  CASES.forEach(([label, args]) => {
    it('refuses ' + label + ' with a 400 and touches no collection', async () => {
      const w = world({});
      await expect(w.reconcile(args)).rejects.toMatchObject({error: 400});
      // The point of Step 0 is that it runs BEFORE anything proportional to the
      // caller's array - a bound checked after the first query protects nothing.
      expect(w.log).toEqual([]);
    });
  });

  it('accepts exactly the cap, so the bound is not off by one', async () => {
    const w = world({});
    const ids = new Array(plan.SARIF_RECONCILE_MAX_TESTS).fill('t');
    await expect(w.reconcile({moduleId: MODULE, testIds: ids})).resolves.toBeDefined();
  });

  it('refuses a call with no options object at all', async () => {
    const w = world({});
    await expect(w.reconcile()).rejects.toMatchObject({error: 400});
    expect(w.log).toEqual([]);
  });
});

// =============================================================================
// Step 1 - the gate chain (AC1, AC4, AC5, AC29).
// =============================================================================

describe('#129 reconcileFromSarif - the gate chain', () => {
  const ARGS = {moduleId: MODULE, testIds: ['t1']};
  const TESTS = [testDoc('t1', SEMGREP_RUN)];

  it('AC1: writes nothing when the project has never seen the toggle', async () => {
    const w = world({tests: TESTS, project: {_id: PROJECT, companyId: CO}});
    expect(await w.reconcile(ARGS)).toEqual(
      {enabled: false, reason: 'toggle-off', created: 0, updated: 0, unchanged: 0,
        skipped: 0, failed: 0});
    expect(w.writes()).toEqual([]);
    expect(w.events).toEqual([]);
  });

  // Strictly `=== true`. `autoCreateCweRisks` is optional with no defaultValue,
  // so "off" is usually "absent" - and nothing truthy-but-not-true may switch a
  // customer's risk register on.
  [['true', 'true'], ['1', 1], ['{}', {}], ['[]', []], ['"on"', 'on']].forEach(([label, value]) => {
    it('AC1: treats a truthy-but-not-true toggle (' + label + ') as off', async () => {
      const w = world({tests: TESTS,
        project: {_id: PROJECT, companyId: CO, autoCreateCweRisks: value}});
      expect((await w.reconcile(ARGS)).reason).toEqual('toggle-off');
      expect(w.writes()).toEqual([]);
    });
  });

  it('AC1 the other direction: a toggle of exactly true does create risks', async () => {
    const w = world({tests: TESTS});
    expect((await w.reconcile(ARGS)).created).toEqual(2);
    expect(w.writes().length).toEqual(2);
  });

  it('AC5: a module with no projectId writes nothing, whatever any toggle says', async () => {
    const w = world({tests: TESTS, module: {_id: MODULE, companyId: CO}});
    expect((await w.reconcile(ARGS)).reason).toEqual('no-project');
    expect(w.writes()).toEqual([]);
    // ...and it stopped there rather than reading a project it has no id for.
    expect(w.log.some((entry) => entry.collection === 'projects')).toBe(false);
  });

  // The Community Edition has one tier: every company has every feature, so
  // there is no licence document to consult any more. This is the regression
  // guard for the former AC4 gate: reconciliation runs to completion on the
  // plain default world (no company/licence concept involved at all).
  it('AC4 (removed in CE): reconciliation is never skipped for a missing feature licence', async () => {
    const w = world({tests: TESTS});
    const result = await w.reconcile(ARGS);
    expect(result.reason).toBeUndefined();
    expect(result.enabled).toBe(true);
    expect(w.writes().length).toBeGreaterThan(0);
  });

  it('AC29: a DDP caller naming another company\'s module is refused with 403', async () => {
    const w = world({tests: TESTS, module: {_id: MODULE, companyId: OTHER_CO, projectId: PROJECT}});
    await expect(w.reconcile(ARGS)).rejects.toMatchObject({error: 403});
    expect(w.writes()).toEqual([]);
  });

  it('AC29: the module gate is checked BEFORE the toggle, so a foreign module ' +
    'with the feature fully on is still refused', async () => {
    const w = world({tests: TESTS, module: {_id: MODULE, companyId: OTHER_CO, projectId: PROJECT}});
    await expect(w.reconcile(ARGS)).rejects.toMatchObject({error: 403});
    expect(w.log.some((entry) => entry.collection === 'projects')).toBe(false);
  });

  it('AC30: the REST path gets a silent no-op instead of a 403 when the module ' +
    'has gone, so a stored document is never turned into an error', async () => {
    const w = world({tests: TESTS, module: null});
    expect(await w.reconcile({moduleId: MODULE, testIds: ['t1'], companyId: CO, actor: ACTOR}))
      .toMatchObject({enabled: false, reason: 'no-module'});
    expect(w.writes()).toEqual([]);
  });

  it('refuses a signed-out DDP caller rather than reading with an undefined company',
    async () => {
      const w = world({tests: TESTS, user: null});
      await expect(w.reconcile(ARGS)).rejects.toMatchObject({error: 403});
      expect(w.log).toEqual([]);
    });

  it('refuses a DDP caller whose profile carries no companyId', async () => {
    const w = world({tests: TESTS, user: {_id: 'u2', profile: {}}});
    await expect(w.reconcile(ARGS)).rejects.toMatchObject({error: 403});
    expect(w.log).toEqual([]);
  });

  it('AC29: a companyId passed WITHOUT an actor is ignored - every selector ' +
    'still carries the session company', async () => {
    // The DDP method forwards only (moduleId, testIds), but nothing stops a
    // future caller from adding a third field. Half a trusted context must not
    // be enough to redirect the write at another tenant.
    const w = world({tests: TESTS});
    await w.reconcile({moduleId: MODULE, testIds: ['t1'], companyId: OTHER_CO});
    const companies = new Set();
    w.log.forEach((entry) => {
      if (entry.selector && typeof entry.selector === 'object' && 'companyId' in entry.selector) {
        companies.add(entry.selector.companyId);
      }
      if (entry.op === 'insert') {
        companies.add(entry.doc.companyId);
      }
    });
    expect(Array.from(companies)).toEqual([CO]);
    expect(companies.has(OTHER_CO)).toBe(false);
  });
});

// =============================================================================
// Step 2 - the stored runs are re-read, never taken from the caller (AC22, AC29).
// =============================================================================

describe('#129 reconcileFromSarif - re-reading the stored documents', () => {
  it('never reaches a Tests document owned by another company', async () => {
    const w = world({tests: [testDoc('t1', SEMGREP_RUN, {companyId: OTHER_CO})]});
    expect(await w.reconcile({moduleId: MODULE, testIds: ['t1']}))
      .toEqual({enabled: true, created: 0, updated: 0, unchanged: 0, skipped: 0, failed: 0});
    expect(w.writes()).toEqual([]);
  });

  it('never reaches a Tests document attached to another module', async () => {
    const w = world({tests: [testDoc('t1', SEMGREP_RUN, {moduleId: 'mod2222222222222'})]});
    expect((await w.reconcile({moduleId: MODULE, testIds: ['t1']})).created).toEqual(0);
  });

  it('ignores a stored document that is not SARIF', async () => {
    const w = world({tests: [testDoc('t1', SEMGREP_RUN, {type: 'SQ'})]});
    expect((await w.reconcile({moduleId: MODULE, testIds: ['t1']})).created).toEqual(0);
  });

  it('AC21/AC18: ids that do not resolve are dropped silently, not refused',
    async () => {
      const w = world({tests: [testDoc('t1', SEMGREP_RUN)]});
      const answer = await w.reconcile({moduleId: MODULE, testIds: ['t1', 'gone', 'alsogone']});
      expect(answer.created).toEqual(2);
      expect(answer.failed).toEqual(0);
    });

  it('AC22: one unparseable stored run costs only its own occurrences', async () => {
    const w = world({tests: [
      testDoc('bad', null, {data: '{"runs": [', tool: 'semgrep'}),
      testDoc('good', SEMGREP_RUN)
    ]});
    const answer = await w.reconcile({moduleId: MODULE, testIds: ['bad', 'good']});
    expect(answer.created).toEqual(2);
    expect(answer.failed).toEqual(0);
    const xss = riskByKey(w.risks, keyFor('CWE-79'));
    expect(xss.riskProperties.sourceRefs.map((entry) => entry.uri))
      .toEqual(['src/app/render.js', 'src/app/reply.js']);
  });

  it('AC22: a stored run with no data at all contributes nothing', async () => {
    const w = world({tests: [testDoc('t1', null, {data: undefined, tool: 'semgrep'})]});
    expect((await w.reconcile({moduleId: MODULE, testIds: ['t1']})).created).toEqual(0);
    expect(w.writes()).toEqual([]);
  });

  it('an empty testIds list answers enabled with all-zero counters and reads no Tests',
    async () => {
      const w = world({tests: []});
      expect(await w.reconcile({moduleId: MODULE, testIds: []}))
        .toEqual({enabled: true, created: 0, updated: 0, unchanged: 0, skipped: 0, failed: 0});
      expect(w.log.some((entry) => entry.collection === 'tests')).toBe(false);
    });
});

// =============================================================================
// Creation (AC6, AC7, AC13, AC28).
// =============================================================================

describe('#129 reconcileFromSarif - what a first import writes', () => {
  it('AC6/AC7: one risk per weakness with the exact document the issue asks for',
    async () => {
      const w = world({tests: [testDoc('t1', SEMGREP_RUN)]});
      const answer = await w.reconcile({moduleId: MODULE, testIds: ['t1']});
      expect(answer).toEqual({enabled: true, created: 2, updated: 0, unchanged: 0,
        skipped: 0, failed: 0});

      const xss = riskByKey(w.risks, keyFor('CWE-79'));
      expect(xss.companyId).toEqual(CO);
      expect(xss.moduleId).toEqual(MODULE);
      expect(xss.projectId).toEqual(PROJECT);
      expect(xss.name).toEqual('[CWE-79] Weakness reported by Semgrep');
      expect(xss.userId).toEqual(ACTOR._id);
      expect(xss.riskProperties.origin).toEqual(['CWE']);
      expect(xss.riskProperties.state).toEqual('identified');
      expect(xss.riskProperties.autoTool).toEqual('semgrep');
      expect(xss.riskProperties.autoCwe).toEqual('CWE-79');
      expect(xss.riskProperties.threatModelContext).toEqual({cwes: ['CWE-79']});
      expect(xss.riskProperties.sourceRefs).toEqual([
        {tool: 'semgrep', ruleId: XSS_RULE.id, uri: 'src/app/render.js',
          level: 'error', count: 2},
        {tool: 'semgrep', ruleId: XSS_RULE.id, uri: 'src/app/reply.js',
          level: 'error', count: 1}
      ]);
      expect(xss.riskProperties.sourceRefsTotal).toEqual(2);
      expect(xss.riskProperties.sourceRefsTruncated).toBe(false);
      // Never written at creation: the banner's N only exists once evidence has
      // been recorded and then gone away.
      expect(xss.riskProperties.sourceRefsPrevCount).toBeUndefined();
    });

  it('AC9: a warning-level weakness is created exactly as an error-level one is',
    async () => {
      // SHELL_RULE's defaultConfiguration is `warning`; XSS_RULE's is `error`.
      // Both must produce a risk, with nothing about the level in the document
      // except the recorded occurrence level.
      const w = world({tests: [testDoc('t1', SEMGREP_RUN)]});
      await w.reconcile({moduleId: MODULE, testIds: ['t1']});
      const shell = riskByKey(w.risks, keyFor('CWE-78'));
      expect(shell).not.toBeNull();
      expect(shell.riskProperties.state).toEqual('identified');
      expect(shell.riskProperties.sourceRefs[0].level).toEqual('warning');
    });

  it('AC28: exactly one cweRiskCreated logevent per risk, attributed to the uploader',
    async () => {
      const w = world({tests: [testDoc('t1', SEMGREP_RUN)]});
      await w.reconcile({moduleId: MODULE, testIds: ['t1']});
      expect(w.events.length).toEqual(2);
      w.events.forEach((event) => {
        expect(event.name).toEqual('logEvent');
        expect(event.args[0]).toBe(ACTOR);
        expect(event.args[2]).toEqual('cweRiskCreated');
      });
      const messages = w.events.map((event) => event.args[1]);
      // The tool reaches the message through the risk NAME, in its display
      // spelling - the message no longer repeats the CWE and the tool a second
      // time after the name that already carries both.
      expect(messages.some((msg) => msg.indexOf('CWE-79') !== -1 &&
        msg.indexOf('Semgrep') !== -1)).toBe(true);
    });

  it('AC17: two tools in one import produce two risks for the same weakness, ' +
    'each carrying only its own occurrences', async () => {
    const w = world({tests: [
      testDoc('t1', run('semgrep', [XSS_RULE], [at(XSS_RULE.id, 'a.js')])),
      testDoc('t2', run('CodeQL', [XSS_RULE], [at(XSS_RULE.id, 'b.js')]))
    ]});
    expect((await w.reconcile({moduleId: MODULE, testIds: ['t1', 't2']})).created).toEqual(2);
    expect(riskByKey(w.risks, keyFor('CWE-79', 'semgrep')).riskProperties.sourceRefs
      .map((entry) => entry.uri)).toEqual(['a.js']);
    expect(riskByKey(w.risks, keyFor('CWE-79', 'codeql')).riskProperties.sourceRefs
      .map((entry) => entry.uri)).toEqual(['b.js']);
  });

  it('AC12: the cap and its disclosure reach the stored document', async () => {
    const results = [];
    for (let i = 0; i < plan.SOURCE_REFS_MAX + 241; i += 1) {
      results.push(at(XSS_RULE.id, 'src/f' + String(i).padStart(5, '0') + '.js'));
    }
    const w = world({tests: [testDoc('t1', run('semgrep', [XSS_RULE], results))]});
    await w.reconcile({moduleId: MODULE, testIds: ['t1']});
    const props = riskByKey(w.risks, keyFor('CWE-79')).riskProperties;
    expect(props.sourceRefs.length).toEqual(plan.SOURCE_REFS_MAX);
    expect(props.sourceRefsTotal).toEqual(plan.SOURCE_REFS_MAX + 241);
    expect(props.sourceRefsTruncated).toBe(true);
    // Truncation is disclosed, never silent: the stored list and the honest
    // total have to disagree, or the detail view cannot say "1000 of 1241".
    expect(props.sourceRefsTotal).toBeGreaterThan(props.sourceRefs.length);
  });

  it('AC16: two runs of the SAME tool in one import union into one risk', async () => {
    const w = world({tests: [
      testDoc('t1', run('semgrep', [XSS_RULE], [at(XSS_RULE.id, 'a.js')])),
      testDoc('t2', run('Semgrep', [XSS_RULE], [at(XSS_RULE.id, 'b.js')]))
    ]});
    expect((await w.reconcile({moduleId: MODULE, testIds: ['t1', 't2']})).created).toEqual(1);
    expect(riskByKey(w.risks, keyFor('CWE-79')).riskProperties.sourceRefs
      .map((entry) => entry.uri)).toEqual(['a.js', 'b.js']);
  });
});

// =============================================================================
// AC15 / AC21 - the requirement the user cared about most, in its sharp form.
// =============================================================================

describe('#129 reconcileFromSarif - a byte-identical re-import performs NO WRITE', () => {
  it('AC15: same ids, unchanged edited, zero updateAsync, zero logevents', async () => {
    const w = world({tests: [testDoc('t1', SEMGREP_RUN)], risks: [storedRisk()]});
    const answer = await w.reconcile({moduleId: MODULE, testIds: ['t1']});
    // CWE-79 is already stored with exactly this evidence; CWE-78 is not.
    expect(answer.unchanged).toEqual(1);
    expect(answer.updated).toEqual(0);
    const xss = riskByKey(w.risks, keyFor('CWE-79'));
    expect(xss._id).toEqual('risk-xss');
    expect(xss.edited).toBeUndefined();
    expect(w.log.filter((entry) => entry.op === 'update')).toEqual([]);
    expect(w.events.map((event) => event.args[2])).toEqual(['cweRiskCreated']);
  });

  it('AC15 the other direction: a document with one occurrence fewer DOES write, ' +
    'exactly once, with exactly one logevent', async () => {
    const w = world({tests: [testDoc('t1', SEMGREP_RUN_FEWER)], risks: [storedRisk()]});
    const answer = await w.reconcile({moduleId: MODULE, testIds: ['t1']});
    expect(answer.updated).toEqual(1);
    const updates = w.log.filter((entry) => entry.op === 'update' &&
      entry.selector._id === 'risk-xss');
    expect(updates.length).toEqual(1);
    const logs = w.events.filter((event) => event.args[2] === 'cweRiskSourceRefsUpdated');
    expect(logs.length).toEqual(1);
    // AC28: the entry names the weakness, the tool and the before/after counts.
    // The tool is spelled the way the product spells it, and goes through the
    // same character filter as the risk name - Company Logs is exported to CSV
    // with `quotes: false`, so a driver name is not safe raw in a message.
    expect(logs[0].args[1]).toContain('CWE-79');
    expect(logs[0].args[1]).toContain('Semgrep');
    expect(logs[0].args[1]).toContain('2 -> 1');
  });

  it('AC21: calling it twice with the same ids is indistinguishable from once',
    async () => {
      const w = world({tests: [testDoc('t1', SEMGREP_RUN)]});
      const first = await w.reconcile({moduleId: MODULE, testIds: ['t1']});
      const afterFirst = JSON.parse(JSON.stringify(w.risks));
      const writesAfterFirst = w.writes().length;
      const eventsAfterFirst = w.events.length;

      const second = await w.reconcile({moduleId: MODULE, testIds: ['t1']});
      expect(first.created).toEqual(2);
      expect(second).toEqual({enabled: true, created: 0, updated: 0, unchanged: 2,
        skipped: 0, failed: 0});
      expect(JSON.parse(JSON.stringify(w.risks))).toEqual(afterFirst);
      expect(w.writes().length).toEqual(writesAfterFirst);
      expect(w.events.length).toEqual(eventsAfterFirst);
    });

  it('AC15: an occurrence list that comes back from Mongo in a different key ' +
    'order is still unchanged', async () => {
    const stored = storedRisk();
    stored.riskProperties.sourceRefs = stored.riskProperties.sourceRefs.map((entry) => ({
      count: entry.count, level: entry.level, uri: entry.uri,
      ruleId: entry.ruleId, tool: entry.tool
    }));
    const w = world({tests: [testDoc('t1', SEMGREP_RUN)], risks: [stored]});
    expect((await w.reconcile({moduleId: MODULE, testIds: ['t1']})).unchanged).toEqual(1);
    expect(w.log.filter((entry) => entry.op === 'update')).toEqual([]);
  });
});

// =============================================================================
// AC18 - two concurrent imports, and the duplicate-key fall-through.
// =============================================================================

describe('#129 reconcileFromSarif - the duplicate-key fall-through (AC18)', () => {
  it('turns the losing insert into the update it really is, without failing', async () => {
    // The race: the identity lookup misses, so the insert branch is taken, but
    // by the time it runs the other import has already written the row. The
    // unique partial index makes that an E11000 rather than a duplicate.
    const w = world({tests: [testDoc('t1', SEMGREP_RUN_FEWER)],
      risks: [storedRisk()], blindFindOne: 1});
    const answer = await w.reconcile({moduleId: MODULE, testIds: ['t1']});
    expect(answer.failed).toEqual(0);
    expect(answer.created).toEqual(0);
    expect(answer.updated).toEqual(1);
    // Exactly one risk for the key - the insert did not add a second.
    expect(w.risks.filter((doc) => doc.riskProperties.autoKey === keyFor('CWE-79')).length)
      .toEqual(1);
    // ...and no "created" logevent for a risk that already existed.
    expect(w.events.map((event) => event.args[2])).toEqual(['cweRiskSourceRefsUpdated']);
  });

  it('reports skipped rather than throwing when the retry lookup also misses',
    async () => {
      const w = world({tests: [testDoc('t1', SEMGREP_RUN_FEWER)],
        risks: [storedRisk()], blindFindOne: 2});
      const answer = await w.reconcile({moduleId: MODULE, testIds: ['t1']});
      expect(answer.skipped).toEqual(1);
      expect(answer.failed).toEqual(0);
    });

  it('AC30: an insert error that is NOT a duplicate key is isolated to its own ' +
    'weakness, and the others are still created', async () => {
    const validation = new Error('Name is required');
    const w = world({tests: [testDoc('t1', SEMGREP_RUN)],
      insertFails: {[keyFor('CWE-79')]: validation}});
    const answer = await w.reconcile({moduleId: MODULE, testIds: ['t1']});
    expect(answer.failed).toEqual(1);
    expect(answer.created).toEqual(1);
    expect(riskByKey(w.risks, keyFor('CWE-78'))).not.toBeNull();
    expect(riskByKey(w.risks, keyFor('CWE-79'))).toBeNull();
  });
});

// =============================================================================
// AC26 / AC27 - the states an import must not touch, and the ones it refreshes.
// =============================================================================

describe('#129 reconcileFromSarif - states', () => {
  managedFields.UNTOUCHED_RISK_STATES.forEach((state) => {
    it('AC26: "' + state + '" is not written to at all, and no second risk is ' +
      'created for its key', async () => {
      const w = world({tests: [testDoc('t1', SEMGREP_RUN_FEWER)], risks: [withState(state)]});
      const answer = await w.reconcile({moduleId: MODULE, testIds: ['t1']});
      expect(answer.skipped).toEqual(1);
      const xss = riskByKey(w.risks, keyFor('CWE-79'));
      expect(xss._id).toEqual('risk-xss');
      expect(xss.edited).toBeUndefined();
      expect(xss.riskProperties.state).toEqual(state);
      expect(xss.riskProperties.sourceRefs.length).toEqual(2);
      expect(w.risks.filter((doc) => doc.riskProperties.autoKey === keyFor('CWE-79')).length)
        .toEqual(1);
      expect(w.events.filter((event) => event.args[2] === 'cweRiskSourceRefsUpdated'))
        .toEqual([]);
    });
  });

  // The other direction. RESOLVED_RISK_STATES would have caught these three too -
  // the interactor deliberately uses the issue's four instead, because a weakness
  // reappearing is what somebody looking at an eliminated risk needs to see.
  ['eliminated', 'deferred', 'expired', 'identified', 'analyzed'].forEach((state) => {
    it('AC27: "' + state + '" DOES get its evidence refreshed, with its state left alone',
      async () => {
        const w = world({tests: [testDoc('t1', SEMGREP_RUN_FEWER)], risks: [withState(state)]});
        expect((await w.reconcile({moduleId: MODULE, testIds: ['t1']})).updated).toEqual(1);
        const xss = riskByKey(w.risks, keyFor('CWE-79'));
        expect(xss.riskProperties.state).toEqual(state);
        expect(xss.riskProperties.sourceRefs.length).toEqual(1);
      });
  });
});

// =============================================================================
// AC19 / AC20 / AC23 - reconciliation against a risk a human has been editing.
// =============================================================================

describe('#129 reconcileFromSarif - a risk a human has edited', () => {
  it('AC23: fewer occurrences replaces the evidence and touches nothing else',
    async () => {
      const w = world({tests: [testDoc('t1', SEMGREP_RUN_FEWER)], risks: [storedRisk()]});
      await w.reconcile({moduleId: MODULE, testIds: ['t1']});
      const xss = riskByKey(w.risks, keyFor('CWE-79'));
      expect(xss._id).toEqual('risk-xss');
      expect(xss.riskProperties.state).toEqual('identified');
      expect(xss.riskProperties.sourceRefs).toEqual([
        {tool: 'semgrep', ruleId: XSS_RULE.id, uri: 'src/app/render.js',
          level: 'error', count: 2}
      ]);
      expect(xss.riskProperties.sourceRefsTotal).toEqual(1);
      // The modifier is allowed to name only the evidence fields and `edited`.
      const update = w.log.find((entry) => entry.op === 'update');
      expect(Object.keys(update.modifier.$set).sort()).toEqual([
        'edited',
        'riskProperties.sourceRefs',
        'riskProperties.sourceRefsTotal',
        'riskProperties.sourceRefsTruncated'
      ]);
    });

  it('AC19: a renamed risk with a rewritten origin and cwes is updated, not duplicated, ' +
    'and keeps every one of those edits', async () => {
    const edited = storedRisk();
    edited.name = 'XSS in the checkout flow - owned by payments';
    edited.riskProperties.origin = ['SQ', 'TM'];
    edited.riskProperties.threatModelContext = {cwes: ['CWE-79', 'CWE-80']};
    const w = world({tests: [testDoc('t1', SEMGREP_RUN_FEWER)], risks: [edited]});
    // Identity is the autoKey, never the name / origin / cwes - so this is an
    // update of the same document and NOT a second creation.
    expect(await w.reconcile({moduleId: MODULE, testIds: ['t1']})).toEqual(
      {enabled: true, created: 0, updated: 1, unchanged: 0, skipped: 0, failed: 0});

    const xss = riskByKey(w.risks, keyFor('CWE-79'));
    expect(xss._id).toEqual('risk-xss');
    expect(xss.name).toEqual('XSS in the checkout flow - owned by payments');
    expect(xss.riskProperties.origin).toEqual(['SQ', 'TM']);
    expect(xss.riskProperties.threatModelContext).toEqual({cwes: ['CWE-79', 'CWE-80']});
    expect(w.risks.filter((doc) => doc.riskProperties.autoKey === keyFor('CWE-79')).length)
      .toEqual(1);
    expect(w.risks.length).toEqual(1);
  });

  it('AC20: a hand-made risk for the same module and weakness is neither adopted ' +
    'nor modified, and does not prevent the auto risk', async () => {
    const manual = {
      _id: 'risk-manual',
      companyId: CO, projectId: PROJECT, moduleId: MODULE,
      name: 'XSS - raised in the design review',
      riskProperties: {
        state: 'identified',
        origin: ['SQ'],
        threatModelContext: {cwes: ['CWE-79']}
      }
    };
    const w = world({tests: [testDoc('t1', SEMGREP_RUN)], risks: [manual]});
    expect((await w.reconcile({moduleId: MODULE, testIds: ['t1']})).created).toEqual(2);

    const stillManual = w.risks.find((doc) => doc._id === 'risk-manual');
    expect(stillManual).toEqual(manual);
    expect(stillManual.riskProperties.autoKey).toBeUndefined();
    expect(stillManual.riskProperties.sourceRefs).toBeUndefined();
    // Both exist; only the auto one carries the identity.
    const forCwe79 = w.risks.filter((doc) =>
      doc.riskProperties.threatModelContext.cwes.indexOf('CWE-79') !== -1);
    expect(forCwe79.length).toEqual(2);
    expect(forCwe79.filter((doc) => doc.riskProperties.autoKey).length).toEqual(1);
  });
});

// =============================================================================
// AC24 - the stale sweep.
// =============================================================================

describe('#129 reconcileFromSarif - the stale sweep', () => {
  it('AC24: a weakness the newer document dropped keeps its id and its state ' +
    'and loses only its evidence', async () => {
    const shell = storedRisk({_id: 'risk-shell'});
    shell.riskProperties.autoKey = keyFor('CWE-78');
    shell.riskProperties.autoCwe = 'CWE-78';
    shell.riskProperties.threatModelContext = {cwes: ['CWE-78']};
    shell.riskProperties.sourceRefs = [{tool: 'semgrep', ruleId: SHELL_RULE.id,
      uri: 'tools/deploy.py', level: 'warning', count: 5}];
    shell.riskProperties.sourceRefsTotal = 5;

    const w = world({tests: [testDoc('t1', SEMGREP_RUN_FEWER)], risks: [storedRisk(), shell]});
    await w.reconcile({moduleId: MODULE, testIds: ['t1']});

    const swept = riskByKey(w.risks, keyFor('CWE-78'));
    expect(swept._id).toEqual('risk-shell');
    expect(swept.riskProperties.sourceRefs).toEqual([]);
    expect(swept.riskProperties.sourceRefsTotal).toEqual(0);
    expect(swept.riskProperties.sourceRefsPrevCount).toEqual(5);
    // Specifically NOT 'eliminated': the import changes no state, ever.
    expect(swept.riskProperties.state).toEqual('identified');
    expect(swept.riskProperties.state).not.toEqual('eliminated');
  });

  it('AC24: a tool whose newest scan reports NO weakness at all still sweeps - ' +
    'the "everything got fixed" case', async () => {
    // This pins the planner deviation the backend flagged: the plan keeps an
    // EMPTY bucket for a tool present in the import that published nothing. Drop
    // that bucket and this reconcile does nothing at all, leaving the register
    // showing evidence the scan says is gone.
    const w = world({tests: [testDoc('t1', SEMGREP_RUN_CLEAN)], risks: [storedRisk()]});
    const answer = await w.reconcile({moduleId: MODULE, testIds: ['t1']});
    expect(answer.created).toEqual(0);
    expect(answer.updated).toEqual(1);
    const xss = riskByKey(w.risks, keyFor('CWE-79'));
    expect(xss.riskProperties.sourceRefs).toEqual([]);
    expect(xss.riskProperties.sourceRefsPrevCount).toEqual(2);
    expect(xss.riskProperties.state).toEqual('identified');
  });

  it('AC24: the second consecutive empty scan writes nothing and logs nothing',
    async () => {
      const gone = storedRisk();
      gone.riskProperties.sourceRefs = [];
      gone.riskProperties.sourceRefsTotal = 0;
      gone.riskProperties.sourceRefsPrevCount = 5;
      const w = world({tests: [testDoc('t1', SEMGREP_RUN_CLEAN)], risks: [gone]});
      const answer = await w.reconcile({moduleId: MODULE, testIds: ['t1']});
      expect(answer.unchanged).toEqual(1);
      expect(answer.updated).toEqual(0);
      expect(w.log.filter((entry) => entry.op === 'update')).toEqual([]);
      expect(w.events).toEqual([]);
      // "0 of 5" does not silently become "0 of 0".
      expect(riskByKey(w.risks, keyFor('CWE-79')).riskProperties.sourceRefsPrevCount)
        .toEqual(5);
    });

  it('AC17: the sweep never touches another tool\'s risks', async () => {
    const codeql = storedRisk({_id: 'risk-codeql'});
    codeql.riskProperties.autoKey = keyFor('CWE-79', 'codeql');
    codeql.riskProperties.autoTool = 'codeql';
    const w = world({tests: [testDoc('t1', SEMGREP_RUN_CLEAN)],
      risks: [storedRisk(), codeql]});
    await w.reconcile({moduleId: MODULE, testIds: ['t1']});
    // semgrep reported nothing, so its risk is emptied...
    expect(riskByKey(w.risks, keyFor('CWE-79')).riskProperties.sourceRefs).toEqual([]);
    // ...and CodeQL, absent from this import, is left exactly as it was.
    const untouched = w.risks.find((doc) => doc._id === 'risk-codeql');
    expect(untouched.riskProperties.sourceRefs.length).toEqual(2);
    expect(untouched.edited).toBeUndefined();
  });

  it('AC20: the sweep never touches a hand-made risk, which has no autoTool',
    async () => {
      const manual = {_id: 'risk-manual', companyId: CO, projectId: PROJECT, moduleId: MODULE,
        name: 'XSS - design review', riskProperties: {state: 'identified', origin: ['SQ']}};
      const w = world({tests: [testDoc('t1', SEMGREP_RUN_CLEAN)], risks: [manual]});
      await w.reconcile({moduleId: MODULE, testIds: ['t1']});
      expect(w.risks.find((doc) => doc._id === 'risk-manual')).toEqual(manual);
      expect(w.writes()).toEqual([]);
    });

  it('AC26: the sweep respects a state a human moved the risk to', async () => {
    const w = world({tests: [testDoc('t1', SEMGREP_RUN_CLEAN)], risks: [withState('closed')]});
    const answer = await w.reconcile({moduleId: MODULE, testIds: ['t1']});
    expect(answer.skipped).toEqual(1);
    expect(riskByKey(w.risks, keyFor('CWE-79')).riskProperties.sourceRefs.length).toEqual(2);
    expect(w.writes()).toEqual([]);
  });

  it('never sweeps a risk on a different module of the same company', async () => {
    const elsewhere = storedRisk({_id: 'risk-other-module', moduleId: 'mod2222222222222'});
    elsewhere.riskProperties.autoKey = 'sarif-cwe|mod2222222222222|semgrep|CWE-79';
    const w = world({tests: [testDoc('t1', SEMGREP_RUN_CLEAN)], risks: [elsewhere]});
    await w.reconcile({moduleId: MODULE, testIds: ['t1']});
    expect(w.writes()).toEqual([]);
  });

  it('AC28: the sweep\'s logevent names the weakness it just emptied', async () => {
    // Pins the PROJECTION deviation: `riskProperties.autoCwe` is read back
    // precisely so this message can name the weakness. Drop it and every stale
    // sweep logs the literal fallback "the weakness" into Company Logs.
    const w = world({tests: [testDoc('t1', SEMGREP_RUN_CLEAN)], risks: [storedRisk()]});
    await w.reconcile({moduleId: MODULE, testIds: ['t1']});
    const logs = w.events.filter((event) => event.args[2] === 'cweRiskSourceRefsUpdated');
    expect(logs.length).toEqual(1);
    expect(logs[0].args[1]).toContain('CWE-79');
    expect(logs[0].args[1]).toContain('Semgrep');
    expect(logs[0].args[1]).toContain('2 -> 0');
    expect(logs[0].args[1]).not.toContain('the weakness');
  });

  it('bounds the sweep, so one import cannot walk an unbounded result set',
    async () => {
      const w = world({tests: [testDoc('t1', SEMGREP_RUN_CLEAN)]});
      await w.reconcile({moduleId: MODULE, testIds: ['t1']});
      const sweep = w.log.find((entry) => entry.collection === 'riskProperties' &&
        entry.op === 'find');
      expect(sweep).toBeDefined();
      expect(typeof sweep.options.limit).toEqual('number');
      expect(sweep.selector.companyId).toEqual(CO);
      expect(sweep.selector.moduleId).toEqual(MODULE);
      expect(sweep.selector['riskProperties.autoTool']).toEqual('semgrep');
    });

  // --- added with the security fix round -----------------------------------
  //
  // A limit with no sort hands back whatever order the storage engine walked, so
  // a module over the limit sweeps a different subset every import and the same
  // document imported twice produces different writes.
  it('sorts the sweep, so WHICH risks a capped-out module sweeps is deterministic',
    async () => {
      const w = world({tests: [testDoc('t1', SEMGREP_RUN_CLEAN)]});
      await w.reconcile({moduleId: MODULE, testIds: ['t1']});
      const sweep = w.log.find((entry) => entry.collection === 'riskProperties' &&
        entry.op === 'find');
      expect(sweep.options.sort).toEqual({'riskProperties.autoKey': 1});
    });
});

// =============================================================================
// Resource bounds - added with the security fix round (major finding 1).
//
// TestImportsCreate makes one tool bucket per SARIF RUN, so a document declaring
// many runs with distinct driver names used to plan tools x 200 risks, each of
// them two Mongo round trips (insert + logEvent), synchronously before
// response.end on a process shared by every tenant. The planner caps it; these
// assert the WRITER actually performs a bounded number of writes, which is the
// property that matters - a cap the writer did not respect would be no cap.
// =============================================================================

describe('#129 reconcileFromSarif - what one import is allowed to write', () => {
  function manyToolsDoc(toolCount, cwes) {
    const runs = [];
    for (let t = 0; t < toolCount; t += 1) {
      const rules = [];
      const results = [];
      for (let i = 1; i <= cwes; i += 1) {
        rules.push({id: 'r' + i, properties: {tags: ['CWE-' + i]},
          defaultConfiguration: {level: 'error'}});
        results.push(at('r' + i, 'f.js'));
      }
      const name = 'tool-' + String(t).padStart(4, '0');
      runs.push(testDoc('t' + t, run(name, rules, results)));
    }
    return runs;
  }

  it('writes a bounded number of risks however many tools the document declares',
    async () => {
      const tests = manyToolsDoc(60, plan.CWE_RISKS_MAX_PER_TOOL);
      const w = world({tests});
      const answer = await w.reconcile({moduleId: MODULE,
        testIds: tests.map((doc) => doc._id)});
      // Uncapped this document plans 60 x 200 = 12,000 risks and ~24,000 writes.
      expect(answer.created).toEqual(plan.CWE_RISKS_MAX_PER_IMPORT);
      const inserts = w.log.filter((entry) => entry.op === 'insert');
      expect(inserts.length).toEqual(plan.CWE_RISKS_MAX_PER_IMPORT);
      expect(w.events.length).toEqual(plan.CWE_RISKS_MAX_PER_IMPORT);
      // ...and the sweep runs once per SURVIVING bucket, not once per run.
      const sweeps = w.log.filter((entry) => entry.collection === 'riskProperties' &&
        entry.op === 'find');
      expect(sweeps.length).toEqual(plan.CWE_RISK_MAX_TOOLS);
    });

  // The index is compound on companyId, so this insert is not refused. With a
  // globally unique autoKey it would have been an E11000, and the fall-through
  // would then re-read inside THIS company, miss, and answer `skipped` - a
  // permanent silent cross-tenant denial of the feature for that weakness.
  it('is not blocked by an identical autoKey planted in another company', async () => {
    const foreign = storedRisk({_id: 'risk-foreign', companyId: OTHER_CO});
    const w = world({tests: [testDoc('t1', SEMGREP_RUN)], risks: [foreign]});
    const answer = await w.reconcile({moduleId: MODULE, testIds: ['t1']});
    expect(answer.created).toEqual(2);
    expect(answer.skipped).toEqual(0);
    const mine = w.risks.filter((doc) => doc.companyId === CO &&
      doc.riskProperties.autoKey === keyFor('CWE-79'));
    expect(mine.length).toEqual(1);
    // ...and the other company's row is untouched.
    const theirs = w.risks.find((doc) => doc._id === 'risk-foreign');
    expect(theirs.companyId).toEqual(OTHER_CO);
    expect(theirs.riskProperties.sourceRefs.length).toEqual(2);
  });

  it('stores a rule id and a uri no larger than their caps', async () => {
    const longRule = 'r'.repeat(plan.SOURCE_REF_RULE_ID_MAX + 400);
    const longUri = 'p/'.repeat(plan.SOURCE_REF_URI_MAX);
    const hostile = run('semgrep',
      [{id: longRule, properties: {tags: ['CWE-79']}, defaultConfiguration: {level: 'error'}}],
      [at(longRule, longUri)]);
    const w = world({tests: [testDoc('t1', hostile)]});
    await w.reconcile({moduleId: MODULE, testIds: ['t1']});
    const stored = riskByKey(w.risks, keyFor('CWE-79')).riskProperties.sourceRefs[0];
    expect(stored.ruleId.length).toEqual(plan.SOURCE_REF_RULE_ID_MAX);
    expect(stored.uri.length).toEqual(plan.SOURCE_REF_URI_MAX);
  });

  // Rec 1: Company Logs renders escaped, but it is exported to CSV with
  // `quotes: false` - so a driver name carrying a comma or a newline forges a
  // row, and one starting `=` forges a spreadsheet formula.
  it('never lets a raw driver name into a log message', async () => {
    const evil = '=HYPERLINK("http://evil.example","x"),injected\nrow';
    const hostile = run(evil,
      [{id: 'r', properties: {tags: ['CWE-79']}, defaultConfiguration: {level: 'error'}}],
      [at('r', 'a.js')]);
    const w = world({tests: [testDoc('t1', hostile)]});
    await w.reconcile({moduleId: MODULE, testIds: ['t1']});
    expect(w.events.length).toEqual(1);
    const message = w.events[0].args[1];
    expect(message).not.toContain('=');
    expect(message).not.toContain(',');
    expect(message).not.toContain('"');
    expect(message).not.toContain('\n');
    // The stored NAME goes through the same filter, and the message is built
    // from it - so both surfaces are covered by one function.
    expect(w.risks[0].name).not.toContain(',');
  });

  it('creates a log message that does not repeat what the risk name already says',
    async () => {
      const w = world({tests: [testDoc('t1', SEMGREP_RUN)]});
      await w.reconcile({moduleId: MODULE, testIds: ['t1']});
      const created = w.events.filter((event) => event.args[2] === 'cweRiskCreated');
      expect(created.length).toEqual(2);
      created.forEach((event) => {
        const message = event.args[1];
        // 'Risk [CWE-79] Weakness reported by Semgrep created (3 occurrences)' -
        // the weakness and the tool appear exactly once each, inside the name.
        expect(message.split('CWE-').length - 1).toEqual(1);
        expect(message.split('Semgrep').length - 1).toEqual(1);
        expect(message).toMatch(/^Risk .+ created \(\d+ occurrences\)$/);
      });
    });
});
