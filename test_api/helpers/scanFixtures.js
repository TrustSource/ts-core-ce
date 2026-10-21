// Submitting scans and cleaning up after them, shared by the scan-hardening behavioural specs.
//
// WHY A HELPER. These specs seed scans, modules, component documents, analysis documents
// and audit entries into a developer's real database - the same one the running app writes
// to - so every one of them has to delete exactly what it created and nothing else. Doing
// that by hand in four spec files is how a cleanup drifts: one file starts deleting by a
// name prefix, and the next developer's unrelated module disappears. The tracker below only
// ever deletes by an id or a key it was handed, and reports the collection counts either
// side so a spec can assert the database came back to where it started.
const supertest = require('supertest');
const {MongoClient} = require('mongodb');
const {connectMongo} = require('./gates');
const {createProject} = require('./projectFixtures');

// A trailing slash on ROOT_URL makes supertest build `//api/v2/...`, which the server
// routes do not match (every request comes back 405), so normalise it.
const ROOT_URL = (process.env.ROOT_URL || '').replace(/\/+$/, '');
const BASE = process.env.BASE;
const API_KEY = process.env.API_KEY;
const PROJECT = 'TEST_SCAN';

// One connection per spec file rather than one per call: the waiters below poll every
// 250ms for up to a minute, and connecting/disconnecting on each pass turned a single
// assertion into hundreds of handshakes. Closed by closeDb() in the spec's afterAll.
let client = null;

/** Run `fn` against the app's database on the shared connection. */
async function withDb(fn) {
  if (!client) { client = await connectMongo(MongoClient); }
  return fn(client.db('meteor'));
}

/** Close the shared connection so Jest does not hang on an open handle. */
async function closeDb() {
  if (client) {
    const open = client;
    client = null;
    await open.close();
  }
}

// ── WHY THE SCANS ARE NOT DEMO DATA, AND WHY THE PROJECT STILL MIGHT BE ───────────────
// Remove demo data in the app (`removeDemoData`) deletes the company's demo scans, modules,
// projects and analysis documents. Run while a spec here is running, it takes the fixture
// away underneath it - which is how `postReprocess` once came back 404 mid-test.
//
// `removeDemoData` (imports/server/collections/projects.js) deletes strictly by
// `{companyId, demo: true}`, collection by collection. So everything THIS helper creates -
// the scans it posts and the modules and analysis documents the server derives from them -
// carries `demo: false` and is genuinely outside that action's reach.
//
// THE SHARED PROJECT IS THE EXCEPTION, and it is not one this file can close. `POST
// /projects` is idempotent on `{companyId, name}`, so only the call that
// actually CREATES `TEST_SCAN` gets to set its `demo` flag - and `scans.spec.js` posts that
// same name with `demo: true` while this file posts `demo: false`. Whichever call reaches an
// empty database first decides, for as long as the row survives, and `removeDemoData` does
// `Projects.removeAsync({companyId, demo: true})`. The project can therefore be demo data and
// can disappear mid-run. That is not a defect to fix here but a condition to tolerate, and
// `ensureProject()` below is how: it re-posts before every submit instead of once, so a reset
// that removed the project between two submits of the same run is repaired rather than fatal.
//
// The scans still have to disappear on their own: they are non-demo rows in a developer's
// real database until the tracker below deletes each one by exact id or key, and cleanup()
// re-counts the very selectors it deleted through so a spec can prove it rather than assume it.
// ──────────────────────────────────────────────────────────────────────────────────────
const DEMO = false;

/**
 * The project every scan below is filed under.
 *
 * Called before every submit, not once per file: the project is shared with other specs
 * that create it as demo data, so a concurrent reset can remove it between two submits of
 * the same run - and resolveProject does not create one, it answers 404.
 *
 * POSTED UNCONDITIONALLY, and the id read off the response. `POST /projects` is idempotent
 * on {companyId, name}: a repeat answers 200 with the id of the project that
 * is already there rather than adding a second one. This used to look the project up in
 * Mongo first - with a selector that was not even company-scoped - purely to work around
 * the duplicate-creating POST that is now fixed. `demo` is only honoured by whichever call
 * actually creates the project, which is why nothing here depends on its value.
 */
async function ensureProject() {
  const project = await createProject(PROJECT, {demo: DEMO});
  return project.projectId;
}

/**
 * POST /api/v2/core/scans, as ts-scan sends it.
 *
 * @param {String} moduleName module name AND moduleIdentifier, so a rerun attaches to the
 *   same module instead of creating a second one
 * @param {Array} dependencies the dependency tree
 * @returns {Object} the supertest response
 */
async function postScan(moduleName, dependencies) {
  await ensureProject();
  return supertest(ROOT_URL).post(`${BASE}/core/scans`)
    .set('user-agent', 'ts-node-client/3.0.1')
    .set('x-api-key', API_KEY)
    .send({project: PROJECT, module: moduleName, moduleId: moduleName, demo: DEMO, dependencies});
}

/**
 * The same POST, but the caller supplies the `dependencies` value as JSON TEXT.
 *
 * Every JSON serialiser in reach is recursive - supertest goes through
 * `fast-safe-stringify`, and even native JSON.stringify overflows the Jest worker's stack
 * at 10 000 levels. The client would then die before the server ever saw the request, and
 * the depth-limit test would look like a server failure. Building the text iteratively and
 * posting it with fetch is what lets a pathological payload actually reach the guard.
 *
 * @param {String} moduleName the module name and identifier
 * @param {String} dependenciesJson the `dependencies` array, already serialised
 * @returns {{status: Number, body: Object|null, text: String}} the response
 */
async function postScanRaw(moduleName, dependenciesJson) {
  await ensureProject();
  const body = '{"project":' + JSON.stringify(PROJECT) +
    ',"module":' + JSON.stringify(moduleName) +
    ',"moduleId":' + JSON.stringify(moduleName) +
    ',"demo":' + JSON.stringify(DEMO) + ',"dependencies":' + dependenciesJson + '}';
  const response = await fetch(`${ROOT_URL}${BASE}/core/scans`, {
    method: 'POST',
    headers: {'content-type': 'application/json',
      'user-agent': 'ts-node-client/3.0.1', 'x-api-key': API_KEY},
    body
  });
  const text = await response.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { /* a non-JSON error page is a result too */ }
  return {status: response.status, body: parsed, text};
}

/** POST /api/v2/core/scans/:id/reprocess */
async function postReprocess(scanId) {
  return supertest(ROOT_URL).post(`${BASE}/core/scans/${scanId}/reprocess`)
    .set('x-api-key', API_KEY).send({});
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Wait for processScan to finish. `dependencyCount` is written by the scan update at the
 * very end of the run, so its presence is the completion signal.
 *
 * @returns {Object|null} the stored scan, or null on timeout
 */
async function waitForProcessed(scanId, timeoutMs = 30000) {
  const started = Date.now();
  for (;;) {
    const scan = await withDb((db) => db.collection('scans').findOne({_id: scanId}));
    if (scan && typeof scan.dependencyCount === 'number') return scan;
    if (Date.now() - started > timeoutMs) return null;
    await sleep(250);
  }
}

/** Wait for the analysis document processScan triggers at the end of a run. */
async function waitForAnalysis(scanId, timeoutMs = 60000) {
  const started = Date.now();
  for (;;) {
    const doc = await withDb((db) => db.collection('analysis').findOne({scanId}));
    if (doc) return doc;
    if (Date.now() - started > timeoutMs) return null;
    await sleep(500);
  }
}

/**
 * Poll a component document until `predicate` holds. Component.store() writes are
 * fire-and-forget, so a single read right after processScan can legitimately miss them.
 */
async function waitForComponent(key, predicate = Boolean, timeoutMs = 20000) {
  const started = Date.now();
  let last = null;
  for (;;) {
    last = await withDb((db) => db.collection('components').findOne({key}));
    if (last && predicate(last)) return last;
    if (Date.now() - started > timeoutMs) return last;
    await sleep(250);
  }
}

/** Regex-escape a fixture-supplied token before it goes into a selector. */
function escapeRegex(value) {
  return String(value).replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
}

/**
 * Every audit message an ingest of these fixtures produces, as ANCHORED patterns.
 *
 * There is no scanId field on `logevents`, so the message is the only handle - but a token
 * dropped into `{$regex: token}` is neither escaped nor anchored, and this delete runs over
 * a collection that holds every tenant's audit trail. The escaped token plus the exact
 * message shape plus a companyId filter is what keeps the blast radius at "entries this run
 * caused". The shapes, from processScan.js, projects.js and RestApi.js:
 *
 *   scanProcessing  'New scan <scanId> processed for <module>'
 *   scanProcessing  'Scan <scanId> for <module>: <n> dependencies skipped'
 *   scanProcessing  'Root component license "<lic>" re-applied to scan <scanId>'
 *   scanProcessing  'Default root component license "<lic>" auto-assigned for module <module>'
 *   scanCreated     'New scan <scanId> created for <module>'
 *   moduleCreated   'New module <module> created'
 *   componentCreated 'New component created <key>'
 *
 * Half of them name only the module or the component key, which is why all three lists are
 * used and not just the scan ids.
 */
const FIXTURE_LOG_TYPES = ['scanProcessing', 'scanCreated', 'moduleCreated', 'componentCreated'];

function fixtureLogSelector(scanIds, moduleNames, componentKeys) {
  const byScan = scanIds.flatMap((id) => {
    const escaped = escapeRegex(id);
    return [
      {message: {$regex: '^(?:New scan|Scan) ' + escaped + ' '}},
      {message: {$regex: ' re-applied to scan ' + escaped + '$'}}
    ];
  });
  const byModule = moduleNames.map((name) => ({
    message: {$regex: '^(?:New module ' + escapeRegex(name) + ' created|' +
      'Default root component license ".*" auto-assigned for module ' +
      escapeRegex(name) + ')$'}
  }));
  const byComponent = componentKeys.map((key) => ({
    message: {$regex: '^New component created ' + escapeRegex(key) + '$'}
  }));
  const patterns = [...byScan, ...byModule, ...byComponent];
  return patterns.length ? {type: {$in: FIXTURE_LOG_TYPES}, $or: patterns} : null;
}

/**
 * Bookkeeping for everything a spec seeds, so it can all be deleted by exact id or key.
 *
 * Nothing here deletes by prefix, pattern or "looks orphaned" - the only inputs are ids and
 * keys the spec itself created, narrowed further by the company the fixtures belong to and,
 * for the shared component catalogue, by "created after this run started".
 */
function createScanTracker() {
  const scanIds = [];
  const moduleNames = [];
  const componentKeys = [];
  const componentIds = [];
  // Captured at construction, before anything is seeded. `components` is a catalogue shared
  // by every tenant with no companyId of its own, so this is what scopes its delete: a
  // document carrying a key this run generated AND created since the run began is this
  // run's, and a hand-curated entry that somehow shares the key is not.
  const startedAt = new Date();
  let baseline = null;

  /**
   * The company the fixtures belong to, read back from what they created. Only ever used to
   * NARROW a delete, so a miss under-deletes rather than over-deletes.
   */
  async function resolveCompanyId(db) {
    const sources = [
      scanIds.length && [db.collection('scans'), {_id: {$in: scanIds}}],
      moduleNames.length && [db.collection('modules'), {name: {$in: moduleNames}}],
      scanIds.length && [db.collection('analysis'), {scanId: {$in: scanIds}}]
    ].filter(Boolean);
    for (const [collection, selector] of sources) {
      const doc = await collection.findOne(selector, {projection: {companyId: 1}});
      if (doc && doc.companyId) return doc.companyId;
    }
    // Nothing this run created is still there, so nothing company-scoped is left to delete.
    return null;
  }

  return {
    scanIds,
    trackScan(scanId) { if (scanId) scanIds.push(scanId); return scanId; },
    trackModule(name) { moduleNames.push(name); return name; },
    trackComponentKeys(...keys) { keys.flat().forEach((k) => k && componentKeys.push(k)); },
    trackComponentId(id) { if (id) componentIds.push(id); return id; },

    /** Collection counts before anything is seeded. Reported, never asserted on - see below. */
    async snapshot() {
      baseline = await withDb(async (db) => ({
        scans: await db.collection('scans').countDocuments(),
        modules: await db.collection('modules').countDocuments()
      }));
      return baseline;
    },

    /**
     * Delete everything tracked, then re-count THE SAME SELECTORS.
     *
     * `owned` - not the global collection counts - is what a spec asserts on. These specs
     * run under the project's default `jest ./test_api/`, which is parallel, so the global
     * count of `scans` at the end of one worker says nothing about that worker: another one
     * legitimately creates and deletes scans throughout. What this run is answerable for is
     * that the ids and keys IT created are gone. `residual` reports that for all six
     * collections; `owned` is the four of them that are not a race against an async writer -
     * see NOTHING_LEFT.
     *
     * IT SWEEPS, it does not delete once. A processScan run keeps writing after the `it`
     * that started it has ended - Component.store()'s audit calls are fire-and-forget, and
     * processScan's final act is `analyzeModule`, which nothing waits for. A single pass
     * therefore deletes the fixture and then watches the tail of its own run write more.
     * The first pass removes the scan and the module, which is what stops new runs; each
     * later pass picks up what the in-flight one produced meanwhile, and the loop ends only
     * after two consecutive passes find nothing left to remove.
     *
     * @returns {Object} {baseline, after, deleted, residual, owned}
     */
    async cleanup({gracePeriodMs = 2000, maxSweeps = 45} = {}) {
      const uniqueKeys = [...new Set(componentKeys)];
      const companyId = await withDb(resolveCompanyId);
      const scoped = (selector) => (companyId ? {...selector, companyId} : selector);
      const logSelector = companyId &&
        fixtureLogSelector(scanIds, moduleNames, uniqueKeys);

      // [key, collection, selector], applied in this order.
      const plan = [
        ['scans', 'scans', scanIds.length && {_id: {$in: scanIds}}],
        ['modules', 'modules', moduleNames.length && companyId && scoped({name: {$in: moduleNames}})],
        ['components', 'components',
          uniqueKeys.length && {key: {$in: uniqueKeys}, created: {$gte: startedAt}}],
        ['componentsById', 'components', componentIds.length && {_id: {$in: componentIds}}],
        ['logevents', 'logevents', logSelector && scoped(logSelector)],
        ['analysis', 'analysis', scanIds.length && {scanId: {$in: scanIds}}]
      ];

      const deleted = {};
      plan.forEach(([name]) => { deleted[name] = 0; });

      async function sweep() {
        let removed = 0;
        for (const [name, collection, selector] of plan) {
          if (!selector) continue;
          const count = (await withDb((db) =>
            db.collection(collection).deleteMany(selector))).deletedCount;
          deleted[name] += count;
          removed += count;
        }
        return removed;
      }

      await sweep();
      let quiet = 0;
      for (let i = 0; i < maxSweeps && quiet < 2; i++) {
        await sleep(gracePeriodMs);
        quiet = (await sweep()) === 0 ? quiet + 1 : 0;
      }
      // One more, unconditionally, so the counts below read the database immediately after
      // a delete rather than after however long the loop spent settling.
      await sweep();

      const residual = {};
      for (const [name, collection, selector] of plan) {
        residual[name] = selector
          ? await withDb((db) => db.collection(collection).countDocuments(selector))
          : 0;
      }
      const owned = {};
      ASSERTED_COLLECTIONS.forEach((name) => { owned[name] = residual[name]; });

      const after = await withDb(async (db) => ({
        scans: await db.collection('scans').countDocuments(),
        modules: await db.collection('modules').countDocuments()
      }));
      return {baseline, after, deleted, residual, owned};
    }
  };
}

/**
 * The collections a spec asserts came back empty, and what that assertion expects.
 *
 * `analysis` and `logevents` are swept and REPORTED but not asserted, because neither has a
 * bound this helper can wait for. The last analysis of a run is written by a remote analyzer
 * some unknown time after the request that triggered it returned - QA measured a 1500-node
 * fixture still analysing after its own afterAll - and Component.store()'s audit writes are
 * fire-and-forget, so both can land after the last sweep however long the sweep waited.
 * Asserting on them would put a stopwatch race into the project's default test command,
 * which is the defect this whole change is removing.
 *
 * The four that are asserted are the ones this run drives synchronously: the scan and module
 * exist by the time the POST answers, and the component documents by the time the spec has
 * seen them. They are also what the assertion is FOR - a selector that does not match what
 * the run created shows up here whatever the timing.
 */
const ASSERTED_COLLECTIONS = ['scans', 'modules', 'components', 'componentsById'];
const NOTHING_LEFT = {scans: 0, modules: 0, components: 0, componentsById: 0};

module.exports = {
  ROOT_URL,
  BASE,
  API_KEY,
  PROJECT,
  withDb,
  closeDb,
  ensureProject,
  postScan,
  postScanRaw,
  postReprocess,
  waitForProcessed,
  waitForAnalysis,
  waitForComponent,
  createScanTracker,
  NOTHING_LEFT,
  DEMO,
  sleep
};
