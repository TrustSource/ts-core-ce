/* eslint-disable no-undef */
// Scan hardening item B - the checksum regex was a detector, not a filter.
//
// `ApiDependencySchema.checksum` rejects anything that is not hex with an optional
// algorithm prefix, and the response says so - but the value was stored anyway: on the scan
// document and, worse, in `components.versions[].checksums[].checksum`, a catalogue shared
// by every tenant. The value is now dropped after validation, so the warning survives and
// the value does not.
const StatusCodes = require('http-status-codes');
const supertest = require('supertest');
const {describeWithMongo} = require('../helpers/gates');
const {
  ROOT_URL, BASE, API_KEY, PROJECT,
  withDb, closeDb, ensureProject, postScan, postReprocess,
  waitForProcessed, waitForComponent, createScanTracker, NOTHING_LEFT, DEMO, sleep
} = require('../helpers/scanFixtures');

const BAD_CHECKSUM = '<img src=x onerror=alert(1)>';
const HEX_40 = 'e4da4ddb5b772cd32cac4b9238158d88808a9f07';
const PREFIXED = 'sha1:' + HEX_40;

function dep(name, key, checksum, children) {
  const node = {name, key, private: false, licenses: [], versions: ['1.0.0'],
    dependencies: children || []};
  if (checksum) node.checksum = checksum;
  return node;
}

/** Every checksum string stored on a component document, across all versions. */
function storedChecksums(doc) {
  return ((doc && doc.versions) || [])
    .flatMap((v) => (v.checksums || []).map((c) => c.checksum));
}

describeWithMongo()('#134 B - a checksum that fails validation must not be stored', () => {
  const tracker = createScanTracker();
  const unique = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

  beforeAll(async () => {
    await tracker.snapshot();
    await ensureProject();
  }, 60000);

  afterAll(async () => {
    const {baseline, after, deleted, residual, owned} = await tracker.cleanup();
    await closeDb();
    console.log('#134 B cleanup:', JSON.stringify({baseline, after, deleted, residual}));
    // NOT a global collection count. This suite runs under the project's default
    // `jest ./test_api/`, which is parallel - so `scans`
    // and `modules` are being changed by other workers throughout. What this run is
    // answerable for is that the ids and keys it created are gone. `owned` is the part of
    // `residual` that can be asserted rather than raced against - see NOTHING_LEFT.
    expect(owned).toEqual(NOTHING_LEFT);
  }, 180000);

  async function submit(suffix, dependencies, keys) {
    const moduleName = `cs-${suffix}-${unique}`;
    tracker.trackModule(moduleName);
    tracker.trackComponentKeys(keys || []);
    const response = await postScan(moduleName, dependencies);
    tracker.trackScan(response.body && response.body.scanId);
    return response;
  }

  // Criteria 11-14.
  describe('a top-level node with a non-hex checksum next to valid ones', () => {
    const badKey = `npm:cs-bad-${unique}`;
    const hexKey = `npm:cs-hex-${unique}`;
    const prefixedKey = `npm:cs-prefixed-${unique}`;
    let response;
    let scan;

    beforeAll(async () => {
      response = await submit('mixed', [
        dep('cs-bad', badKey, BAD_CHECKSUM),
        dep('cs-hex', hexKey, HEX_40),
        dep('cs-prefixed', prefixedKey, PREFIXED)
      ], [badKey, hexKey, prefixedKey]);
      scan = await waitForProcessed(response.body.scanId, 60000);
    }, 120000);

    // Criterion 11 - unchanged behaviour, the warning still names the field.
    it('still answers 201 and names `checksum` in the warning', () => {
      expect(response.status).toBe(StatusCodes.CREATED);
      const offenders = (response.body.warning.messages || [])
        .map((m) => m.details && m.details.name);
      expect(offenders).toContain('checksum');
    });

    // Criterion 12.
    it('does not store the rejected value on the scan', () => {
      const bad = scan.dependencies.find((d) => d.key === badKey);
      expect(bad).toBeDefined();
      expect(Object.keys(bad)).not.toContain('checksum');
    });

    // Criterion 13.
    it('does not store the rejected value on the shared component document', async () => {
      const doc = await waitForComponent(badKey);
      expect(doc).not.toBeNull();
      expect(storedChecksums(doc)).not.toContain(BAD_CHECKSUM);
      expect(JSON.stringify(doc)).not.toContain(BAD_CHECKSUM);
    }, 60000);

    // Criterion 14 - the drop is surgical, valid checksums are untouched.
    it('keeps both valid checksum forms on the scan and on the component', async () => {
      const hex = scan.dependencies.find((d) => d.key === hexKey);
      const prefixed = scan.dependencies.find((d) => d.key === prefixedKey);
      expect(hex.checksum).toBe(HEX_40);
      expect(prefixed.checksum).toBe(PREFIXED);

      const hexDoc = await waitForComponent(hexKey, (d) => storedChecksums(d).length > 0);
      const prefixedDoc = await waitForComponent(prefixedKey, (d) => storedChecksums(d).length > 0);
      expect(storedChecksums(hexDoc)).toContain(HEX_40);
      expect(storedChecksums(prefixedDoc)).toContain(PREFIXED);
    }, 60000);
  });

  // Criterion 15 - the recursion used to stop at the first invalid child, so a bad checksum
  // deeper in the tree was reported but never cleaned.
  it('drops a bad checksum on a third-level child, and on a second offender', async () => {
    const l1 = `npm:cs-l1-${unique}`;
    const l2 = `npm:cs-l2-${unique}`;
    const l3 = `npm:cs-l3-${unique}`;
    const sibling = `npm:cs-l3b-${unique}`;
    const response = await submit('deep', [
      dep('cs-l1', l1, null, [
        dep('cs-l2', l2, null, [
          dep('cs-l3', l3, BAD_CHECKSUM),
          dep('cs-l3b', sibling, BAD_CHECKSUM)
        ])
      ])
    ], [l1, l2, l3, sibling]);

    expect(response.status).toBe(StatusCodes.CREATED);
    const offenders = (response.body.warning.messages || [])
      .map((m) => m.details && m.details.name);
    expect(offenders).toContain('checksum');

    const scan = await waitForProcessed(response.body.scanId, 60000);
    const level3 = scan.dependencies[0].dependencies[0].dependencies;
    expect(level3).toHaveLength(2);
    level3.forEach((node) => expect(Object.keys(node)).not.toContain('checksum'));

    for (const key of [l3, sibling]) {
      const doc = await waitForComponent(key);
      expect(doc).not.toBeNull();
      expect(JSON.stringify(doc)).not.toContain(BAD_CHECKSUM);
    }
  }, 120000);

  // Criterion 16 - the UI/import path shares ingestScan, so it gets the same treatment.
  it('CycloneDX import: reports the bad hash and stores nothing of it', async () => {
    const name = `cs-cydx-${unique}`;
    const key = `npm:${name}`;
    const moduleName = `cs-cydx-mod-${unique}`;
    tracker.trackModule(moduleName);
    tracker.trackComponentKeys([key]);

    await ensureProject();
    const response = await supertest(ROOT_URL).post(`${BASE}/core/imports/scan/cyclonedx`)
      .query({project: PROJECT, module: moduleName, demo: DEMO})
      .set('x-api-key', API_KEY)
      .send({
        bomFormat: 'CycloneDX', specVersion: '1.4', version: 1,
        components: [{
          type: 'library', name, version: '7.0.3', purl: `pkg:npm/${name}@7.0.3`,
          hashes: [{alg: 'SHA-1', content: 'not-hex-at-all-<script>'}]
        }]
      });
    expect(response.status).toBe(StatusCodes.CREATED);
    tracker.trackScan(response.body && response.body.scanId);

    const offenders = ((response.body.warning && response.body.warning.messages) || [])
      .map((m) => m.details && m.details.name);
    expect(offenders).toContain('checksum');

    await waitForProcessed(response.body.scanId, 60000);
    const doc = await waitForComponent(key);
    expect(doc).not.toBeNull();
    expect(JSON.stringify(doc)).not.toContain('not-hex-at-all');
  }, 120000);

  // Criterion 17 - explicitly out of scope: values written before this fix stay put.
  it('leaves a checksum already in the catalogue alone', async () => {
    const key = `npm:cs-legacy-${unique}`;
    tracker.trackComponentKeys([key]);
    await withDb((db) => db.collection('components').insertOne({
      _id: `cs-legacy-${unique}`,
      key,
      name: 'cs-legacy',
      created: new Date(),
      createdBy: 'jest',
      versions: [{version: '1.0.0', checksums: [{checksum: BAD_CHECKSUM, qos: 20}]}]
    }));

    const response = await submit('legacy', [dep('cs-legacy', key, HEX_40)], [key]);
    expect(response.status).toBe(StatusCodes.CREATED);
    await waitForProcessed(response.body.scanId, 60000);
    await sleep(2000);

    const doc = await withDb((db) => db.collection('components').findOne({key}));
    expect(storedChecksums(doc)).toContain(BAD_CHECKSUM);
  }, 120000);

  // Security review finding 3. Dropping the value at the ingest boundary closes the front
  // door only: POST /scans/:id/reprocess re-runs processScan over the STORED scan and
  // revalidates nothing, so a scan written before 3.2.69 still carried its refused value
  // into the shared catalogue. The same expression now guards the two catalogue write
  // sites, which closes this route and every other caller of processScan at once.
  it('does not carry a stored bad checksum into the catalogue on reprocess', async () => {
    const key = `npm:cs-reprocess-${unique}`;
    const response = await submit('reprocess', [dep('cs-reprocess', key, HEX_40)], [key]);
    expect(response.status).toBe(StatusCodes.CREATED);
    const scanId = response.body.scanId;
    expect(await waitForProcessed(scanId, 60000)).not.toBeNull();
    await waitForComponent(key, (d) => storedChecksums(d).includes(HEX_40));

    // Exactly what a pre-3.2.69 scan document looks like: the refused value on the node,
    // never seen by cleanAndValidateDependency again.
    await withDb((db) => db.collection('scans').updateOne({_id: scanId},
      {$set: {'dependencies.0.checksum': BAD_CHECKSUM, dependencyCount: null}}));
    expect((await postReprocess(scanId)).status).toBe(StatusCodes.CREATED);
    expect(await waitForProcessed(scanId, 60000)).not.toBeNull();
    await sleep(3000);   // Component.store() writes are fire-and-forget

    const doc = await withDb((db) => db.collection('components').findOne({key}));
    expect(storedChecksums(doc)).not.toContain(BAD_CHECKSUM);
    expect(storedChecksums(doc)).toContain(HEX_40);
  }, 180000);
});
