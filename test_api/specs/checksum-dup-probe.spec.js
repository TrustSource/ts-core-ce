/* eslint-disable no-undef, sonarjs/no-duplicate-string */
const supertest = require('supertest');
const StatusCodes = require('http-status-codes');
const ROOT_URL = process.env.ROOT_URL;
const BASE = process.env.BASE;
const API_KEY = process.env.API_KEY;
const {MongoClient} = require('mongodb');
// This probe reads the database the scanned components land in, so it can only run where
// the app and its MongoDB are on the same machine. Gated rather than defaulted to a local
// port: on CI that default spent 150s in the driver's server-selection timeout and then
// failed as five hook timeouts naming nothing. See test_api/helpers/gates.js.
const {describeWithMongo, connectMongo} = require('../helpers/gates');
const {expectProjectCreatedOrExisting} = require('../helpers/projectFixtures');

const PROJECT = 'TEST_SCAN';

async function readComponent(componentKey) {
  const c = await connectMongo(MongoClient);
  try {
    const collectionName = componentKey.startsWith('im:') ? 'infrastructureComponents' : 'components';
    return await c.db('meteor').collection(collectionName).findOne({key: componentKey});
  } finally {
    await c.close();
  }
}

async function removeComponent(componentKey) {
  const c = await connectMongo(MongoClient);
  try {
    const collectionName = componentKey.startsWith('im:') ? 'infrastructureComponents' : 'components';
    await c.db('meteor').collection(collectionName).deleteMany({key: componentKey});
  } finally {
    await c.close();
  }
}

function waitFor(predicate, attempts = 30, intervalMs = 1000) {
  return (async () => {
    for (let i = 0; i < attempts; i++) {
      const ok = await predicate();
      if (ok) return ok;
      await new Promise(r => setTimeout(r, intervalMs));
    }
    return null;
  })();
}

function buildDep(depKey, version, checksum) {
  return {
    name: depKey.split(':').slice(1).join(':'),
    key: depKey,
    private: false,
    licenses: [],
    dependencies: [],
    versions: [version],
    checksum,
  };
}

async function submitScan(moduleName, dependencies) {
  const body = {
    project: PROJECT,
    module: moduleName,
    moduleId: moduleName,
    demo: true,
    dependencies,
  };
  return supertest(ROOT_URL).post(`${BASE}/core/scans`)
    .set('user-agent', 'ts-node-client/3.0.1')
    .set('x-api-key', API_KEY)
    .send(body);
}

async function submitScanWithDep(moduleName, depKey, version, checksum) {
  return submitScan(moduleName, [buildDep(depKey, version, checksum)]);
}

describeWithMongo()('Component version duplication probe', () => {
  beforeAll(async () => {
    // ensure project exists - 201 the first time, 200 + existing afterwards.
    // The status is asserted because everything below assumes this project is there: without
    // it a failed create surfaces as a confusing 404 from the scan submit instead.
    await supertest(ROOT_URL).post(`${BASE}/core/projects`)
      .send({name: PROJECT, demo: true})
      .set('x-api-key', API_KEY)
      .expect(expectProjectCreatedOrExisting);
  });

  it('two scans, same component/version, different checksums → 1 version with 2 checksums (NOT duplicate versions)', async () => {
    const unique = Date.now();
    const depKey = `npm:probe-pkg-${unique}`;
    const version = '7.0.3';
    const ckA = 'a'.repeat(40);    // unprefixed hex, matches production data
    const ckB = 'b'.repeat(40);

    await removeComponent(depKey);    // start clean

    // Submit scan A
    const respA = await submitScanWithDep(`probe-mod-A-${unique}`, depKey, version, ckA);
    expect(respA.status).toBe(StatusCodes.CREATED);

    // Wait until the component appears with version 7.0.3 + checksum A
    const compAfterA = await waitFor(async () => {
      const c = await readComponent(depKey);
      if (!c || !c.versions) return null;
      const v = c.versions.find(v => v.version === version);
      if (!v || !v.checksums || !v.checksums.length) return null;
      return c;
    });
    expect(compAfterA).not.toBeNull();
    console.log('AFTER SCAN A:', JSON.stringify({
      versions: compAfterA.versions.map(v => ({version: v.version, checksums: v.checksums}))
    }, null, 2));

    // Submit scan B with same dep, same version, different checksum
    const respB = await submitScanWithDep(`probe-mod-B-${unique}`, depKey, version, ckB);
    expect(respB.status).toBe(StatusCodes.CREATED);

    // Wait until checksum B is present
    const compAfterB = await waitFor(async () => {
      const c = await readComponent(depKey);
      if (!c || !c.versions) return null;
      const hasB = c.versions.some(v => v.checksums && v.checksums.some(ck => ck.checksum === ckB));
      return hasB ? c : null;
    });
    expect(compAfterB).not.toBeNull();
    console.log('AFTER SCAN B:', JSON.stringify({
      versions: compAfterB.versions.map(v => ({version: v.version, checksums: v.checksums}))
    }, null, 2));

    // The point of the probe: how many DISTINCT version entries (by ===) carry "7.0.3"?
    const v703entries = compAfterB.versions.filter(v => v.version === version);
    console.log(`Number of entries with version=='${version}':`, v703entries.length);

    expect(v703entries.length).toBe(1);
  }, 90000);

  it('CONCURRENT scans: two scans submitted in parallel for the same component/version with different checksums', async () => {
    const unique = Date.now() + Math.floor(Math.random() * 1000);
    const depKey = `npm:probe-pkg-concurrent-${unique}`;
    const version = '7.0.3';
    await removeComponent(depKey);

    // Fire two scans simultaneously - each will load the component, see no version, push it
    const checksums = ['a', 'b', 'c', 'd', 'e'].map(ch => ch.repeat(40));
    const respPromises = checksums.map((ck, i) =>
      submitScanWithDep(`probe-mod-concurrent-${unique}-${i}`, depKey, version, ck)
    );
    const resps = await Promise.all(respPromises);
    resps.forEach(r => expect(r.status).toBe(StatusCodes.CREATED));

    // wait a few seconds for all defers to settle
    await new Promise(r => setTimeout(r, 4000));

    const comp = await readComponent(depKey);
    expect(comp).not.toBeNull();

    console.log('AFTER CONCURRENT SCANS:', JSON.stringify({
      versions: comp.versions.map(v => ({version: v.version, checksumCount: v.checksums ? v.checksums.length : 0, checksums: v.checksums}))
    }, null, 2));

    const v703entries = comp.versions.filter(v => v.version === version);
    console.log(`entries with version=='${version}':`, v703entries.length);

    const allDocs = await (async () => {
      const c = await connectMongo(MongoClient);
      try { return await c.db('meteor').collection('components').find({key: depKey}).toArray(); }
      finally { await c.close(); }
    })();
    console.log(`component docs with key='${depKey}':`, allDocs.length);
  }, 120000);

  it('cydx import: same component duplicated with different hashes', async () => {
    const unique = Date.now() + Math.floor(Math.random() * 1000);
    const name = `probe-pkg-cydx-${unique}`;
    const depKey = `npm:${name}`;
    await removeComponent(depKey);
    await removeComponent(`generic:${name}`);

    const sbom = {
      bomFormat: 'CycloneDX',
      specVersion: '1.4',
      version: 1,
      components: [
        {
          type: 'library',
          name,
          version: '7.0.3',
          purl: `pkg:npm/${name}@7.0.3`,
          hashes: [{alg: 'SHA-1', content: 'a'.repeat(40)}],
        },
        {
          type: 'library',
          name,
          version: '7.0.3',
          purl: `pkg:npm/${name}@7.0.3`,
          hashes: [{alg: 'SHA-1', content: 'b'.repeat(40)}],
        },
      ],
    };

    const resp = await supertest(ROOT_URL).post(`${BASE}/core/imports/scan/cyclonedx`)
      .query({project: PROJECT, module: `probe-mod-cydx-${unique}`, demo: true})
      .set('x-api-key', API_KEY)
      .send(sbom);
    expect(resp.status).toBe(StatusCodes.CREATED);

    const comp = await waitFor(async () => {
      const c = await readComponent(depKey);
      if (!c || !c.versions || !c.versions.length) return null;
      return c;
    });
    expect(comp).not.toBeNull();

    console.log('AFTER CYDX IMPORT:', JSON.stringify({
      versions: comp.versions.map(v => ({version: v.version, checksums: v.checksums}))
    }, null, 2));

    const v703entries = comp.versions.filter(v => v.version === '7.0.3');
    console.log(`entries with version=='7.0.3':`, v703entries.length);

    // Sanity: only 1 component doc, 1 version entry
    const allDocs = await (async () => {
      const c = await connectMongo(MongoClient);
      try { return await c.db('meteor').collection('components').find({key: depKey}).toArray(); }
      finally { await c.close(); }
    })();
    console.log(`component docs with key='${depKey}':`, allDocs.length);
    expect(v703entries.length).toBe(1);
  }, 90000);

  it('ONE scan, two deps: same component, version strings differ in whitespace ("7.0.3" vs " 7.0.3")', async () => {
    const unique = Date.now() + Math.floor(Math.random() * 1000);
    const depKey = `npm:probe-pkg-wsvariant-${unique}`;
    const ckA = 'a'.repeat(40);
    const ckB = 'b'.repeat(40);

    await removeComponent(depKey);

    // dep1 has clean "7.0.3", dep2 has " 7.0.3" (leading space) - visually identical to a user
    const resp = await submitScan(`probe-mod-wsvariant-${unique}`, [
      buildDep(depKey, '7.0.3', ckA),
      buildDep(depKey, ' 7.0.3', ckB),
    ]);
    expect(resp.status).toBe(StatusCodes.CREATED);

    const comp = await waitFor(async () => {
      const c = await readComponent(depKey);
      if (!c || !c.versions || c.versions.length < 1) return null;
      return c;
    });
    expect(comp).not.toBeNull();

    console.log('AFTER WHITESPACE-VARIANT SCAN:', JSON.stringify({
      versions: comp.versions.map(v => ({
        version: v.version,
        versionRaw: JSON.stringify(v.version),    // show whitespace
        checksums: v.checksums
      }))
    }, null, 2));

    console.log(`total version entries:`, comp.versions.length);
    console.log(`entries that render visually as "7.0.3":`, comp.versions.filter(v => v.version.trim() === '7.0.3').length);
  }, 90000);

  it('ONE scan with two deps: same component key + same version + different checksums', async () => {
    const unique = Date.now() + Math.floor(Math.random() * 1000);
    const depKey = `npm:probe-pkg-onescan-${unique}`;
    const version = '7.0.3';
    const ckA = 'a'.repeat(40);
    const ckB = 'b'.repeat(40);

    await removeComponent(depKey);

    // Submit a single scan that lists the same component twice with different checksums
    const resp = await submitScan(`probe-mod-onescan-${unique}`, [
      buildDep(depKey, version, ckA),
      buildDep(depKey, version, ckB),
    ]);
    expect(resp.status).toBe(StatusCodes.CREATED);

    const comp = await waitFor(async () => {
      const c = await readComponent(depKey);
      if (!c || !c.versions || !c.versions.length) return null;
      return c;
    });
    expect(comp).not.toBeNull();

    console.log('AFTER ONE SCAN (two deps):', JSON.stringify({
      versions: comp.versions.map(v => ({version: v.version, checksums: v.checksums}))
    }, null, 2));

    const v703entries = comp.versions.filter(v => v.version === version);
    console.log(`entries with version=='${version}':`, v703entries.length);

    // also count component documents - if the upsert raced, we may have created duplicates
    const allDocs = await (async () => {
      const c = await connectMongo(MongoClient);
      try { return await c.db('meteor').collection('components').find({key: depKey}).toArray(); }
      finally { await c.close(); }
    })();
    console.log(`number of component docs with key='${depKey}':`, allDocs.length);

    expect(v703entries.length).toBe(1);
    expect(allDocs.length).toBe(1);
  }, 90000);
});
