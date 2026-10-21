/* eslint-disable no-undef */
// Scan hardening item A - one malformed dependency must not destroy a whole scan's processing,
// and item H - the scan is written back field by field instead of as a whole document.
//
// Before this change, a nested dependency with neither `key` nor `purl` passed the 400 gate
// (dependency-level validation only produces a `warning`), was stored, and then threw
// `Cannot read properties of undefined (reading 'toLowerCase')` inside the deferred
// processScan run. The throw killed the run: valid siblings never reached the catalogue,
// `dependencyCount` was never written, and no analysis document was produced - while the
// client already held its 201.
const StatusCodes = require('http-status-codes');
const {describeWithMongo} = require('../helpers/gates');
const {
  withDb, closeDb, ensureProject, postScan, postReprocess,
  waitForProcessed, waitForAnalysis, createScanTracker, NOTHING_LEFT
} = require('../helpers/scanFixtures');

const SKIP_NO_IDENTIFIER = 'no usable identifier';

/** A node with everything the schema wants. */
function valid(name, key, children) {
  return {name, key, private: false, licenses: [], versions: ['1.0.0'],
    dependencies: children || []};
}

/** Collect every node of a stored tree, depth first. */
function walk(dependencies, out = []) {
  for (const dep of dependencies || []) {
    out.push(dep);
    walk(dep.dependencies, out);
  }
  return out;
}

describeWithMongo()('#134 A/H - a malformed dependency must not take out the scan', () => {
  const tracker = createScanTracker();
  const unique = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

  beforeAll(async () => {
    await tracker.snapshot();
    await ensureProject();
  }, 60000);

  afterAll(async () => {
    const {baseline, after, deleted, residual, owned} = await tracker.cleanup();
    await closeDb();
    console.log('#134 A cleanup:', JSON.stringify({baseline, after, deleted, residual}));
    // NOT a global collection count. This suite runs under the project's default
    // `jest ./test_api/`, which is parallel - so `scans`
    // and `modules` are being changed by other workers throughout. What this run is
    // answerable for is that the ids and keys it created are gone. `owned` is the part of
    // `residual` that can be asserted rather than raced against - see NOTHING_LEFT.
    expect(owned).toEqual(NOTHING_LEFT);
  }, 180000);

  /** Submit and register everything the run will create, so cleanup can find it. */
  async function submit(moduleSuffix, dependencies, keys) {
    const moduleName = `iso-${moduleSuffix}-${unique}`;
    tracker.trackModule(moduleName);
    tracker.trackComponentKeys(keys || []);
    const response = await postScan(moduleName, dependencies);
    tracker.trackScan(response.body && response.body.scanId);
    return {moduleName, response};
  }

  // Criteria 1, 2, 10.
  describe('20 valid nodes and one node with neither key nor purl', () => {
    const keys = Array.from({length: 20}, (_, i) => `npm:iso-ok-${unique}-${i}`);
    let scan;
    let response;

    beforeAll(async () => {
      const deps = keys.map((key, i) => valid(`iso-ok-${i}`, key));
      // The bad node carries versions, so `key`/`purl` are the only things it fails on.
      deps.splice(10, 0, {name: `iso-bad-${unique}`, private: false, licenses: [],
        versions: ['1.0.0'], dependencies: []});
      const submitted = await submit('mixed', deps, keys);
      response = submitted.response;
      scan = await waitForProcessed(response.body.scanId, 60000);
    }, 120000);

    it('answers 201 with the 3.2.68 warning contract intact', () => {
      expect(response.status).toBe(StatusCodes.CREATED);
      expect(Object.keys(response.body).sort())
        .toEqual(['info', 'moduleId', 'scanId', 'warning']);
      expect(response.body.warning.object).toBe(`Dependency:iso-bad-${unique}`);
    });

    it('finishes the run: every valid sibling gets a component ref and a catalogue doc', async () => {
      expect(scan).not.toBeNull();
      const stored = walk(scan.dependencies);
      const good = stored.filter((d) => d.key && d.key.startsWith(`npm:iso-ok-${unique}`));
      expect(good).toHaveLength(20);
      good.forEach((d) => {
        expect(typeof (d.component && d.component._id)).toBe('string');
      });
      const docs = await withDb((db) =>
        db.collection('components').find({key: {$in: keys}}).project({key: 1}).toArray());
      expect(docs).toHaveLength(20);
    }, 60000);

    it('counts the skipped node as part of the tree', () => {
      expect(scan.dependencyCount).toBe(21);
    });

    it('records exactly one skipped dependency, locatable by path', () => {
      expect(scan.skippedDependencyCount).toBe(1);
      expect(scan.skippedDependencies).toHaveLength(1);
      expect(scan.skippedDependencies[0]).toEqual({
        path: '/',
        name: `iso-bad-${unique}`,
        reason: SKIP_NO_IDENTIFIER
      });
    });

    // Criterion 9: one aggregated audit entry per run that skipped something.
    it('writes exactly one scanProcessing entry naming the scan and the count', async () => {
      const events = await withDb((db) => db.collection('logevents').find({
        type: 'scanProcessing', message: {$regex: response.body.scanId}
      }).toArray());
      const skipEvents = events.filter((e) => /skipped/i.test(e.message));
      expect(skipEvents).toHaveLength(1);
      expect(skipEvents[0].message).toContain(response.body.scanId);
      expect(skipEvents[0].message).toContain('1');
    }, 60000);

    // The rest of criterion 1: the valid components are analysed, with the keyless node
    // still sitting in the stored tree where processing deliberately left it.
    //
    // This needs ts-analysis 3.7.7 or later. Before it, the analyzer's own
    // walk dereferenced the missing key and the invocation died with `Runtime exited with
    // error: exit status 1`, so this payload produced zero analysis documents while every
    // assertion above already passed. A failure here against an environment running an
    // older analyzer is that, not a regression in the scan path.
    it('produces an analysis for the valid components, keyless node and all', async () => {
      const analysis = await waitForAnalysis(response.body.scanId, 90000);
      expect(analysis).not.toBeNull();
      // The 20 identifiable siblings are analysed; the node that carried no identifier
      // contributes no component and is not counted as one.
      const analysed = (analysis.components || []).map((c) => c.key).sort();
      expect(analysed).toEqual(keys.slice().sort());
    }, 120000);
  });

  // Criterion 3: an unparseable purl next to a usable key is not a reason to skip.
  it('processes a node whose key is valid and whose purl cannot be parsed', async () => {
    const key = `npm:iso-badpurl-${unique}`;
    const {response} = await submit('badpurl', [{
      name: 'iso-badpurl', key, purl: 'not-a-purl', private: false,
      licenses: [], versions: ['1.0.0'], dependencies: []
    }], [key]);
    expect(response.status).toBe(StatusCodes.CREATED);

    const scan = await waitForProcessed(response.body.scanId, 60000);
    expect(scan).not.toBeNull();
    expect(scan.skippedDependencies).toBeUndefined();
    expect(typeof scan.dependencies[0].component._id).toBe('string');
    const doc = await withDb((db) => db.collection('components').findOne({key}));
    expect(doc).not.toBeNull();
  }, 120000);

  // Criteria 4 and 5: an unparseable purl with no key IS skipped - and its children,
  // which are real components, are still walked.
  it('skips a node with only an unparseable purl, but still processes its children', async () => {
    const childKeys = [`npm:iso-kid-a-${unique}`, `npm:iso-kid-b-${unique}`];
    const siblingKey = `npm:iso-sib-${unique}`;
    const {response} = await submit('orphan', [
      {
        name: 'iso-orphan', purl: 'not-a-purl', private: false, licenses: [],
        versions: ['1.0.0'],
        dependencies: childKeys.map((key, i) => valid(`iso-kid-${i}`, key))
      },
      valid('iso-sib', siblingKey)
    ], [...childKeys, siblingKey]);
    expect(response.status).toBe(StatusCodes.CREATED);

    const scan = await waitForProcessed(response.body.scanId, 60000);
    expect(scan).not.toBeNull();
    expect(scan.skippedDependencyCount).toBe(1);
    expect(scan.skippedDependencies[0]).toMatchObject({
      path: '/', name: 'iso-orphan', purl: 'not-a-purl', reason: SKIP_NO_IDENTIFIER
    });

    const kids = scan.dependencies[0].dependencies;
    expect(kids).toHaveLength(2);
    kids.forEach((kid) => expect(typeof (kid.component && kid.component._id)).toBe('string'));
    expect(typeof scan.dependencies[1].component._id).toBe('string');

    const docs = await withDb((db) => db.collection('components')
      .find({key: {$in: [...childKeys, siblingKey]}}).project({key: 1}).toArray());
    expect(docs).toHaveLength(3);
  }, 120000);

  // Criteria 6, 7 and 9's negative half.
  it('leaves both fields absent on an all-valid scan, and clears stale ones on reprocess', async () => {
    const key = `npm:iso-clean-${unique}`;
    const {response} = await submit('clean', [valid('iso-clean', key)], [key]);
    expect(response.status).toBe(StatusCodes.CREATED);
    const scanId = response.body.scanId;

    const scan = await waitForProcessed(scanId, 60000);
    expect(scan).not.toBeNull();
    expect(Object.keys(scan)).not.toContain('skippedDependencies');
    expect(Object.keys(scan)).not.toContain('skippedDependencyCount');

    const events = await withDb((db) => db.collection('logevents')
      .find({type: 'scanProcessing', message: {$regex: scanId}}).toArray());
    expect(events.filter((e) => /skipped/i.test(e.message))).toHaveLength(0);

    // A record left over from an earlier, worse payload must not outlive it. A
    // whole-document replace removed absent fields implicitly; a $set does not, which is
    // why the write carries an explicit $unset.
    await withDb((db) => db.collection('scans').updateOne({_id: scanId},
      {$set: {skippedDependencies: [{path: '/', name: 'stale', reason: SKIP_NO_IDENTIFIER}],
        skippedDependencyCount: 1, dependencyCount: null}}));

    const reprocess = await postReprocess(scanId);
    expect(reprocess.status).toBe(StatusCodes.CREATED);
    const reprocessed = await waitForProcessed(scanId, 60000);
    expect(reprocessed).not.toBeNull();
    expect(Object.keys(reprocessed)).not.toContain('skippedDependencies');
    expect(Object.keys(reprocessed)).not.toContain('skippedDependencyCount');
  }, 180000);

  // Criterion 8: the entry list is capped, the count is not.
  it('caps the recorded entries at 100 while counting all 150', async () => {
    const deps = Array.from({length: 150}, (_, i) => ({
      name: `iso-many-${i}`, private: false, licenses: [], versions: ['1.0.0'],
      dependencies: []
    }));
    const {response} = await submit('many', deps, []);
    expect(response.status).toBe(StatusCodes.CREATED);

    const scan = await waitForProcessed(response.body.scanId, 90000);
    expect(scan).not.toBeNull();
    expect(scan.skippedDependencies).toHaveLength(100);
    expect(scan.skippedDependencyCount).toBe(150);
    expect(scan.dependencyCount).toBe(150);
  }, 180000);

  // Criterion 37: the scan write names its fields, so a concurrent write to another field
  // of the same document is no longer clobbered by a whole-document replace.
  it('does not clobber a field written into the scan while it was being processed', async () => {
    // Big enough that the run is still going when the response lands: ~1.7ms per node
    // measured, so 1500 nodes is a couple of seconds of walking.
    const keys = Array.from({length: 1500}, (_, i) => `npm:iso-slow-${unique}-${i}`);
    const {response} = await submit('slow', keys.map((key, i) => valid(`iso-slow-${i}`, key)), keys);
    expect(response.status).toBe(StatusCodes.CREATED);
    const scanId = response.body.scanId;

    // The scan document exists from the moment of the insert, and processScan holds its
    // own in-memory copy until the very end. Asserting the run has NOT finished yet is
    // what stops this test from passing vacuously on a fast machine.
    const midRun = await withDb((db) => db.collection('scans')
      .findOne({_id: scanId}, {projection: {dependencyCount: 1}}));
    expect(midRun).not.toBeNull();
    expect(midRun.dependencyCount).toBeUndefined();

    const binaryLink = {name: `iso-binary-${unique}`, url: 'https://example.com/artifact.jar'};
    await withDb((db) => db.collection('scans').updateOne({_id: scanId},
      {$set: {binaryLinks: [binaryLink]}}));

    const scan = await waitForProcessed(scanId, 180000);
    expect(scan).not.toBeNull();
    expect(scan.dependencyCount).toBe(1500);
    expect(scan.binaryLinks).toEqual([binaryLink]);
  }, 300000);
});
