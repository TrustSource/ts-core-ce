/* eslint-disable no-undef */
// Scan hardening item C - a too-deeply-nested payload answered 500 "Internal Server Error".
//
// Mongo refuses a document with more than 180 levels of BSON nesting, and each dependency
// level costs two of them (the `dependencies` array plus the object inside it), so a chain
// of 90 dependencies could not be inserted. The failure surfaced at Scans.insertAsync,
// after the request had already paid for full schema validation and had created a module -
// and the caller got an opaque server error for a client-side problem.
//
// The guard now runs before any of that: 400 with a message naming the limit and the
// offending node, nothing inserted, no module created.
const StatusCodes = require('http-status-codes');
const {describeWithMongo} = require('../helpers/gates');
const {
  withDb, closeDb, ensureProject, postScan, postScanRaw,
  waitForProcessed, waitForAnalysis, createScanTracker, NOTHING_LEFT
} = require('../helpers/scanFixtures');

const {MAX_SCAN_DEPENDENCY_DEPTH} = require('../../imports/server/scan/dependencyDepth');

/** A chain of `n` nested dependencies, each with its own component key. */
function chain(n, tag) {
  let node = null;
  for (let i = n - 1; i >= 0; i--) {
    node = {name: `dp${i}`, key: `npm:dp-${tag}-${i}`, private: false, licenses: [],
      versions: ['1.0.0'], dependencies: node ? [node] : []};
  }
  return [node];
}

function chainKeys(n, tag) {
  return Array.from({length: n}, (_, i) => `npm:dp-${tag}-${i}`);
}

// The same chain as JSON TEXT, built from the inside out. Needed only for the pathological
// depth: every JSON serialiser in reach recurses and overflows the Jest worker's stack at
// 10 000 levels, so the request would never leave the client.
function chainJson(n, tag) {
  let json = '[]';
  for (let i = n - 1; i >= 0; i--) {
    json = `[{"name":"dp${i}","key":"npm:dp-${tag}-${i}","private":false,` +
      `"licenses":[],"versions":["1.0.0"],"dependencies":${json}}]`;
  }
  return json;
}

describeWithMongo()('#134 C - dependency nesting is rejected with 400, not 500', () => {
  const tracker = createScanTracker();
  const unique = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

  beforeAll(async () => {
    await tracker.snapshot();
    await ensureProject();
  }, 60000);

  afterAll(async () => {
    const {baseline, after, deleted, residual, owned} = await tracker.cleanup();
    await closeDb();
    console.log('#134 C cleanup:', JSON.stringify({baseline, after, deleted, residual}));
    // NOT a global collection count. This suite runs under the project's default
    // `jest ./test_api/`, which is parallel - so `scans`
    // and `modules` are being changed by other workers throughout. What this run is
    // answerable for is that the ids and keys it created are gone. `owned` is the part of
    // `residual` that can be asserted rather than raced against - see NOTHING_LEFT.
    expect(owned).toEqual(NOTHING_LEFT);
  }, 180000);

  async function submit(suffix, dependencies, keys) {
    const moduleName = `depth-${suffix}-${unique}`;
    tracker.trackModule(moduleName);
    tracker.trackComponentKeys(keys || []);
    const response = await postScan(moduleName, dependencies);
    tracker.trackScan(response.body && response.body.scanId);
    return {moduleName, response};
  }

  // Criterion 19.
  it(`accepts and processes a payload at exactly ${MAX_SCAN_DEPENDENCY_DEPTH} levels`, async () => {
    const tag = `at-${unique}`;
    const {response} = await submit('at', chain(MAX_SCAN_DEPENDENCY_DEPTH, tag),
      chainKeys(MAX_SCAN_DEPENDENCY_DEPTH, tag));
    expect(response.status).toBe(StatusCodes.CREATED);

    const scan = await waitForProcessed(response.body.scanId, 60000);
    expect(scan).not.toBeNull();
    expect(scan.dependencyCount).toBe(MAX_SCAN_DEPENDENCY_DEPTH);
    expect(await waitForAnalysis(response.body.scanId, 90000)).not.toBeNull();
  }, 180000);

  // Criterion 20.
  it(`accepts a payload one level under the limit`, async () => {
    const tag = `under-${unique}`;
    const depth = MAX_SCAN_DEPENDENCY_DEPTH - 1;
    const {response} = await submit('under', chain(depth, tag), chainKeys(depth, tag));
    expect(response.status).toBe(StatusCodes.CREATED);

    const scan = await waitForProcessed(response.body.scanId, 60000);
    expect(scan).not.toBeNull();
    expect(scan.dependencyCount).toBe(depth);
  }, 180000);

  // Criterion 21.
  it('rejects one level over the limit with an ErrorResponse and writes nothing', async () => {
    const tag = `over-${unique}`;
    const depth = MAX_SCAN_DEPENDENCY_DEPTH + 1;
    const moduleName = `depth-over-${unique}`;
    const keys = chainKeys(depth, tag);

    const response = await postScan(moduleName, chain(depth, tag));
    expect(response.status).toBe(StatusCodes.BAD_REQUEST);
    expect(response.body.error).toEqual(expect.any(String));
    expect(Array.isArray(response.body.messages)).toBe(true);
    expect(response.body.description).toContain(String(MAX_SCAN_DEPENDENCY_DEPTH));
    expect(response.body.description).toContain(`npm:dp-${tag}-${MAX_SCAN_DEPENDENCY_DEPTH}`);
    expect(response.body.scanId).toBeUndefined();

    // Nothing was created: the guard runs before module resolution and before the insert.
    const leftovers = await withDb(async (db) => ({
      modules: await db.collection('modules').countDocuments({name: moduleName}),
      components: await db.collection('components').countDocuments({key: {$in: keys}})
    }));
    expect(leftovers).toEqual({modules: 0, components: 0});
  }, 120000);

  // Criterion 22 - the input the guard exists for. A recursive check would stack-overflow
  // here and turn the 400 back into a 500.
  it('rejects a 10 000-level chain, and the next valid scan still works', async () => {
    const tag = `huge-${unique}`;
    const moduleName = `depth-huge-${unique}`;
    const response = await postScanRaw(moduleName, chainJson(10000, tag));
    expect(response.status).toBe(StatusCodes.BAD_REQUEST);
    expect(response.body.description).toContain(String(MAX_SCAN_DEPENDENCY_DEPTH));

    const modules = await withDb((db) =>
      db.collection('modules').countDocuments({name: moduleName}));
    expect(modules).toBe(0);

    const okKey = `npm:depth-after-huge-${unique}`;
    const {response: ok} = await submit('after', [{
      name: 'depth-after-huge', key: okKey, private: false, licenses: [],
      versions: ['1.0.0'], dependencies: []
    }], [okKey]);
    expect(ok.status).toBe(StatusCodes.CREATED);
  }, 180000);
});
