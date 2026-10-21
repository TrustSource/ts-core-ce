/* eslint-disable no-undef */
// Scan hardening items E, F, G, I and J - the deferred path does less work and writes more
// safely, without changing what ends up stored.
//
//   E  one Mongo round trip per dependency that already exists, instead of an
//      unconditional upsert followed by a find - and `oldKey` now resolves deterministically.
//   F  the change tracker the Component class already maintains decides whether to write,
//      instead of serialising the whole (tenant-shared, version-heavy) document twice.
//   G  the per-node `hash` nothing ever read is gone.
//   I  the multi-key license expansion no longer appends to the scan document it is
//      iterating.
//   J  the root-license pick is pushed with a conditional update, so two concurrent scans
//      of one module cannot both push it.
const StatusCodes = require('http-status-codes');
const {describeWithMongo} = require('../helpers/gates');
const {
  withDb, closeDb, ensureProject, postScan, postReprocess,
  waitForProcessed, waitForAnalysis, waitForComponent, createScanTracker, NOTHING_LEFT, sleep
} = require('../helpers/scanFixtures');

const ROOT_LICENSE = 'ROOT_SAMPLE';   // the company default in the fixture database

function node(name, key, extra) {
  return Object.assign({name, key, private: false, licenses: [], versions: ['1.0.0'],
    dependencies: []}, extra || {});
}

/** Every key of every node in a stored tree. */
function walkKeys(dependencies, out = []) {
  for (const dep of dependencies || []) {
    out.push(dep);
    walkKeys(dep.dependencies, out);
  }
  return out;
}

describeWithMongo()('#134 E/F/G/I/J - fewer writes, safer writes', () => {
  const tracker = createScanTracker();
  const unique = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

  beforeAll(async () => {
    await tracker.snapshot();
    await ensureProject();
  }, 60000);

  afterAll(async () => {
    const {baseline, after, deleted, residual, owned} = await tracker.cleanup();
    await closeDb();
    console.log('#134 E/F/G/I/J cleanup:', JSON.stringify({baseline, after, deleted, residual}));
    // NOT a global collection count. This suite runs under the project's default
    // `jest ./test_api/`, which is parallel - so `scans`
    // and `modules` are being changed by other workers throughout. What this run is
    // answerable for is that the ids and keys it created are gone. `owned` is the part of
    // `residual` that can be asserted rather than raced against - see NOTHING_LEFT.
    expect(owned).toEqual(NOTHING_LEFT);
  }, 180000);

  async function submit(moduleName, dependencies, keys) {
    tracker.trackModule(moduleName);
    tracker.trackComponentKeys(keys || []);
    const response = await postScan(moduleName, dependencies);
    tracker.trackScan(response.body && response.body.scanId);
    return response;
  }

  // ── item G ──────────────────────────────────────────────────────────────────────────
  describe('G - the unread per-node hash', () => {
    // Criterion 35.
    it('is absent from every node of a newly ingested scan', async () => {
      const keys = [`npm:hash-root-${unique}`, `npm:hash-kid-${unique}`];
      const response = await submit(`hash-${unique}`,
        [node('hash-root', keys[0], {dependencies: [node('hash-kid', keys[1])]})], keys);
      expect(response.status).toBe(StatusCodes.CREATED);

      const scan = await waitForProcessed(response.body.scanId, 60000);
      expect(scan).not.toBeNull();
      walkKeys(scan.dependencies).forEach((dep) => {
        expect(Object.keys(dep)).not.toContain('hash');
      });
    }, 120000);

    // Criterion 36 - old scans still carry the field; reprocessing one must not trip over it.
    it('does not stop a scan that already has stored hash values from reprocessing', async () => {
      const key = `npm:hash-legacy-${unique}`;
      const response = await submit(`hash-legacy-${unique}`, [node('hash-legacy', key)], [key]);
      const scanId = response.body.scanId;
      expect(await waitForProcessed(scanId, 60000)).not.toBeNull();

      await withDb((db) => db.collection('scans').updateOne({_id: scanId},
        {$set: {'dependencies.0.hash': -12345, dependencyCount: null}}));
      expect((await postReprocess(scanId)).status).toBe(StatusCodes.CREATED);

      const reprocessed = await waitForProcessed(scanId, 60000);
      expect(reprocessed).not.toBeNull();
      expect(reprocessed.dependencyCount).toBe(1);
      expect(await waitForAnalysis(scanId, 90000)).not.toBeNull();
    }, 180000);
  });

  // ── item E ──────────────────────────────────────────────────────────────────────────
  describe('E - lookup before write', () => {
    // Criterion 31. Splitting the old `$or: [{key}, {oldKey}]` into two point lookups is
    // what makes this deterministic: with the $or, a key present as `key` on one document
    // and as `oldKey` on another resolved to whichever Mongo yielded first - and the
    // unconditional upsert had already created that second document.
    it('resolves a renamed component through oldKey instead of creating a shell', async () => {
      const oldKey = `npm:renamed-old-${unique}`;
      const newKey = `npm:renamed-new-${unique}`;
      const docId = `renamed-${unique}`;
      tracker.trackComponentId(docId);
      tracker.trackComponentKeys([oldKey, newKey]);

      await withDb((db) => db.collection('components').insertOne({
        _id: docId, key: newKey, oldKey, name: 'renamed', created: new Date(),
        createdBy: 'jest', versions: [{version: '1.0.0'}]
      }));

      const response = await submit(`renamed-${unique}`,
        [node('renamed', oldKey, {versions: ['9.9.9']})], []);
      expect(response.status).toBe(StatusCodes.CREATED);
      expect(await waitForProcessed(response.body.scanId, 60000)).not.toBeNull();

      const doc = await waitForComponent(newKey,
        (d) => (d.versions || []).some((v) => v.version === '9.9.9'));
      expect(doc._id).toBe(docId);
      expect((doc.versions || []).map((v) => v.version)).toContain('9.9.9');

      const shells = await withDb((db) =>
        db.collection('components').countDocuments({key: oldKey}));
      expect(shells).toBe(0);
    }, 120000);
  });

  // ── item F ──────────────────────────────────────────────────────────────────────────
  describe('F - the change tracker decides whether to write', () => {
    const key = `npm:tracker-${unique}`;
    const rootKey = `npm:tracker-root-${unique}`;
    const moduleName = `tracker-${unique}`;
    // Everything that used to set `_changed` unconditionally, in one node.
    const richNode = () => node('tracker', key, {
      description: 'a component with every unconditional setter exercised',
      homepageUrl: 'https://example.com/tracker',
      repoUrl: 'https://github.com/example/tracker',
      licenses: [{name: 'MIT'}],
      checksum: 'a'.repeat(40),
      crypto_algorithms: [{algorithm: 'AES', strength: '256'}],
      ai_models: [{name: 'tracker-model', version: '1.0'}],
      meta: {versions: [{version: '1.0.0'}]}
    });
    let firstScanId;

    beforeAll(async () => {
      const response = await submit(moduleName,
        [node('tracker-root', rootKey, {dependencies: [richNode()]})], [key, rootKey]);
      expect(response.status).toBe(StatusCodes.CREATED);
      firstScanId = response.body.scanId;
      await waitForProcessed(firstScanId, 60000);
      await waitForComponent(key, (d) => !!d.updated || (d.versions || []).length > 0);
      await sleep(2000);   // Component.store() writes are fire-and-forget
    }, 180000);

    // Criterion 33 (the runnable form of "zero update ops": Component.store() always
    // stamps `updated`, so an unchanged `updated` and "no write happened" are the same
    // statement).
    it('reprocessing an identical scan leaves the component document byte-identical', async () => {
      const before = await withDb((db) => db.collection('components').findOne({key}));
      expect(before).not.toBeNull();

      await withDb((db) => db.collection('scans').updateOne({_id: firstScanId},
        {$set: {dependencyCount: null}}));
      expect((await postReprocess(firstScanId)).status).toBe(StatusCodes.CREATED);
      expect(await waitForProcessed(firstScanId, 60000)).not.toBeNull();
      await sleep(3000);

      const after = await withDb((db) => db.collection('components').findOne({key}));
      expect(after).toEqual(before);
    }, 180000);

    // Criterion 34.
    it('a genuinely new version still writes, and bumps updated/updatedBy', async () => {
      const before = await withDb((db) => db.collection('components').findOne({key}));
      const changed = richNode();
      changed.versions = ['2.0.0'];
      changed.checksum = 'b'.repeat(40);
      changed.meta = {versions: [{version: '2.0.0'}]};

      const response = await submit(`${moduleName}-v2`,
        [node('tracker-root', rootKey, {dependencies: [changed]})], []);
      expect(response.status).toBe(StatusCodes.CREATED);
      await waitForProcessed(response.body.scanId, 60000);

      const after = await waitForComponent(key,
        (d) => (d.versions || []).some((v) => v.version === '2.0.0'));
      expect((after.versions || []).map((v) => v.version)).toContain('2.0.0');
      expect(after.updatedBy).toBe('ScanProcessor');
      expect(new Date(after.updated).getTime())
        .toBeGreaterThan(new Date(before.updated || before.created).getTime());
    }, 180000);
  });

  // ── item I ──────────────────────────────────────────────────────────────────────────
  describe('I - the license expansion must not append to the scan it is iterating', () => {
    // `im:` reaches createComponentFromDependency reliably - that is the only path with
    // the multi-key expansion. "CDDL+GPL License" is one of the two names
    // matchWellknownLicenseName expands (licenseMatch.js).
    const key = `im:expand-${unique}`;
    const rootKey = `npm:expand-root-${unique}`;
    const moduleName = `expand-${unique}`;
    const payloadLicenses = [{name: 'CDDL+GPL License'}];
    let scanId;

    /** The node under test: a CHILD, so applyRootLicense does not overwrite its licenses. */
    async function expansionNode() {
      const scan = await withDb((db) => db.collection('scans').findOne({_id: scanId}));
      return scan.dependencies[0].dependencies[0];
    }

    beforeAll(async () => {
      const response = await submit(moduleName, [node('expand-root', rootKey, {
        dependencies: [node('expand', key, {
          versions: ['1.0.0', '2.0.0'],
          licenses: JSON.parse(JSON.stringify(payloadLicenses))
        })]
      })], [key, rootKey]);
      expect(response.status).toBe(StatusCodes.CREATED);
      scanId = response.body.scanId;
      await waitForProcessed(scanId, 60000);
      await sleep(2000);
    }, 180000);

    // Criteria 39 and 41.
    it('stores as many license entries as were submitted, still name-normalised', async () => {
      const stored = (await expansionNode()).licenses;
      expect(stored).toHaveLength(payloadLicenses.length);
      expect(stored[0].name).toBe('CDDL-1.1');
    }, 60000);

    // Criterion 40 - the expansion itself still reaches every version row. Neither name is
    // a license this instance knows, so they land as names rather than keys; what matters
    // is that BOTH halves of the expansion reach BOTH versions.
    it('applies every expanded license to each version of the component', async () => {
      const doc = await waitForComponent(key, (d) => (d.versions || []).length === 2);
      expect(doc).not.toBeNull();
      expect(doc.versions).toHaveLength(2);
      doc.versions.forEach((version) => {
        const names = (version.licenses || []).map((l) => l.key || l.name);
        expect(names).toEqual(expect.arrayContaining(['CDDL-1.1', 'GPL-2.0']));
      });
    }, 60000);

    // Criterion 42.
    it('does not grow the node license list over repeated reprocessing', async () => {
      for (let run = 0; run < 3; run++) {
        await withDb((db) => db.collection('scans').updateOne({_id: scanId},
          {$set: {dependencyCount: null}}));
        expect((await postReprocess(scanId)).status).toBe(StatusCodes.CREATED);
        expect(await waitForProcessed(scanId, 60000)).not.toBeNull();
      }
      expect((await expansionNode()).licenses).toHaveLength(payloadLicenses.length);
    }, 240000);
  });

  // ── item J ──────────────────────────────────────────────────────────────────────────
  describe('J - the root-license pick is pushed conditionally', () => {
    const moduleName = `rootpick-${unique}`;
    const rootKey = `npm:rootpick-${unique}`;
    let moduleId;

    /** The module's saved picks for this root key. */
    async function picks() {
      const module = await withDb((db) => db.collection('modules').findOne({_id: moduleId}));
      expect(module).not.toBeNull();
      return ((module.componentConfig && module.componentConfig.licensesSelected) || [])
        .filter((entry) => entry && entry.key === rootKey);
    }

    // Every response names the module it resolved to. Reading it back each time rather than
    // trusting the one from beforeAll keeps this block correct if the module is re-created
    // under a new id mid-run - Remove demo data leaves the fixtures alone, but the PROJECT they
    // hang off is demo data another spec created and another worker can remove.
    function rememberModule(response) {
      if (response.body && response.body.moduleId) moduleId = response.body.moduleId;
      return response;
    }

    // The push only happens for a company whose default root-component license is one of
    // its private licenses. A fixture database has ROOT_SAMPLE set up that way; a fresh
    // installation does not, so the block sets it for its own run and restores it after.
    let companyRestore = null;

    beforeAll(async () => {
      // Create the module up front so the concurrent pair below cannot race on creating it
      // too - what is under test here is the push, not module resolution.
      const seed = await submit(moduleName, [node('rootpick', rootKey)], [rootKey]);
      expect(seed.status).toBe(StatusCodes.CREATED);
      moduleId = seed.body.moduleId;
      await waitForProcessed(seed.body.scanId, 60000);
      await withDb(async (db) => {
        const module = await db.collection('modules').findOne({_id: moduleId}, {projection: {companyId: 1}});
        const company = await db.collection('companies').findOne({_id: module.companyId},
          {projection: {defaultRootComponentLicense: 1, privateLicenses: 1}});
        const hasPrivate = (company.privateLicenses || []).some((l) => l && l.key === ROOT_LICENSE);
        if (company.defaultRootComponentLicense !== ROOT_LICENSE || !hasPrivate) {
          companyRestore = {
            _id: company._id,
            defaultRootComponentLicense: company.defaultRootComponentLicense,
            addedPrivate: !hasPrivate
          };
          const update = {$set: {defaultRootComponentLicense: ROOT_LICENSE}};
          if (!hasPrivate) update.$push = {privateLicenses: {key: ROOT_LICENSE, name: 'Root Sample'}};
          await db.collection('companies').updateOne({_id: company._id}, update);
        }
      });
      await withDb((db) => db.collection('modules').updateOne({_id: moduleId},
        {$unset: {'componentConfig.licensesSelected': ''}}));
    }, 180000);

    afterAll(async () => {
      if (!companyRestore) return;
      await withDb(async (db) => {
        const update = companyRestore.defaultRootComponentLicense === undefined ?
          {$unset: {defaultRootComponentLicense: ''}} :
          {$set: {defaultRootComponentLicense: companyRestore.defaultRootComponentLicense}};
        if (companyRestore.addedPrivate) update.$pull = {privateLicenses: {key: ROOT_LICENSE}};
        await db.collection('companies').updateOne({_id: companyRestore._id}, update);
      });
    });

    // Criteria 43 and 44.
    it('two concurrent scans of one module push exactly one entry', async () => {
      const responses = await Promise.all([0, 1].map(() =>
        postScan(moduleName, [node('rootpick', rootKey)])));
      responses.forEach((r) => {
        expect(r.status).toBe(StatusCodes.CREATED);
        tracker.trackScan(r.body.scanId);
        rememberModule(r);
      });
      const scans = await Promise.all(responses.map((r) =>
        waitForProcessed(r.body.scanId, 90000)));
      scans.forEach((scan) => expect(scan).not.toBeNull());

      expect(await picks()).toEqual([expect.objectContaining({
        key: rootKey, license: ROOT_LICENSE
      })]);
      // Criterion 44 - each scan still carries the resolved pick on its own root.
      scans.forEach((scan) => {
        expect(scan.dependencies[0].licenses)
          .toEqual([expect.objectContaining({key: ROOT_LICENSE})]);
      });
    }, 240000);

    // Criterion 46.
    it('a following sequential scan adds no further entry', async () => {
      const response = rememberModule(await postScan(moduleName, [node('rootpick', rootKey)]));
      tracker.trackScan(response.body.scanId);
      expect(await waitForProcessed(response.body.scanId, 90000)).not.toBeNull();
      expect(await picks()).toHaveLength(1);
    }, 180000);

    // Criterion 45.
    it('honours a manual entry and pushes nothing beside it', async () => {
      await withDb((db) => db.collection('modules').updateOne({_id: moduleId},
        {$set: {'componentConfig.licensesSelected': [
          {key: rootKey, license: 'ROOT_OTHER', comment: 'manual'}
        ]}}));

      const response = rememberModule(await postScan(moduleName, [node('rootpick', rootKey)]));
      tracker.trackScan(response.body.scanId);
      const scan = await waitForProcessed(response.body.scanId, 90000);
      expect(scan).not.toBeNull();

      expect(await picks()).toEqual([expect.objectContaining({
        key: rootKey, license: 'ROOT_OTHER', comment: 'manual'
      })]);
      expect(scan.dependencies[0].licenses)
        .toEqual([expect.objectContaining({key: 'ROOT_OTHER'})]);
    }, 180000);
  });
});
