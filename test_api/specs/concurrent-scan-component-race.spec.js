/* eslint-disable no-undef, sonarjs/no-duplicate-string */
const supertest = require('supertest');
const StatusCodes = require('http-status-codes');
const {MongoClient} = require('mongodb');

const ROOT_URL = process.env.ROOT_URL;
const BASE = process.env.BASE;
const API_KEY = process.env.API_KEY;
// Reads the component documents the concurrent scans produce, so it only runs where the
// app and its MongoDB share a machine. Gated rather than defaulted to a local port - on
// CI that default cost 121s of server-selection timeout before failing. See
// test_api/helpers/gates.js.
const {describeWithMongo, connectMongo} = require('../helpers/gates');
const {expectProjectCreatedOrExisting} = require('../helpers/projectFixtures');
const PROJECT = 'TEST_SCAN';

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
  return supertest(ROOT_URL).post(`${BASE}/core/scans`)
    .set('user-agent', 'ts-node-client/3.0.1')
    .set('x-api-key', API_KEY)
    .send({project: PROJECT, module: moduleName, moduleId: moduleName, demo: true, dependencies});
}

async function mongo(fn) {
  const c = await connectMongo(MongoClient);
  try { return await fn(c.db('meteor')); }
  finally { await c.close(); }
}

describeWithMongo()('Concurrent scans for a brand-new component must not duplicate documents', () => {
  beforeAll(async () => {
    // 201 the first time, 200 + existing afterwards. The status is asserted
    // because every scan below resolves this project by NAME: a failed create surfaces as a
    // 404 from the scan submit rather than as the fixture problem it is.
    await supertest(ROOT_URL).post(`${BASE}/core/projects`)
      .send({name: PROJECT, demo: true})
      .set('x-api-key', API_KEY)
      .expect(expectProjectCreatedOrExisting);
  });

  it('5 concurrent scans, same key + same version, different checksums → exactly 1 component doc', async () => {
    const unique = Date.now() + Math.floor(Math.random() * 1000);
    const depKey = `npm:race-pkg-${unique}`;
    const version = '7.0.3';
    const checksums = ['a', 'b', 'c', 'd', 'e'].map(ch => ch.repeat(40));

    await mongo(db => db.collection('components').deleteMany({key: depKey}));

    const resps = await Promise.all(checksums.map((ck, i) =>
      submitScan(`race-mod-${unique}-${i}`, [buildDep(depKey, version, ck)])
    ));
    resps.forEach(r => expect(r.status).toBe(StatusCodes.CREATED));

    // wait for all deferred processScan runs to settle
    await new Promise(r => setTimeout(r, 5000));

    const docs = await mongo(db => db.collection('components').find({key: depKey}).toArray());

    if (docs.length !== 1) {
      console.log('DUPLICATE DOCS:', JSON.stringify(docs.map(d => ({
        _id: d._id,
        key: d.key,
        created: d.created,
        versions: d.versions,
      })), null, 2));
    }

    expect(docs).toHaveLength(1);
  }, 90000);

  it('rejects scan dependency with non-hex checksum content (XSS guard)', async () => {
    const unique = Date.now() + Math.floor(Math.random() * 1000);
    const depKey = `npm:xss-checksum-probe-${unique}`;
    // 24 chars, fails the hex-only check but passes min:10
    const evil = '<script>alert(1)</scr>';

    const resp = await submitScan(`xss-mod-${unique}`, [{
      name: 'xss-checksum-probe',
      key: depKey,
      private: false,
      licenses: [],
      dependencies: [],
      versions: ['1.0.0'],
      checksum: evil,
    }]);
    expect(resp.status).toBe(StatusCodes.CREATED);
    expect(resp.body && resp.body.warning && resp.body.warning.messages).toBeDefined();
    const offenders = (resp.body.warning.messages || []).map(m => m.details && m.details.name);
    expect(offenders).toContain('checksum');
  }, 60000);

  it('CycloneDX import propagates `hashes` to the component version checksums', async () => {
    const unique = Date.now() + Math.floor(Math.random() * 1000);
    const name = `cydx-hashes-${unique}`;
    const depKey = `npm:${name}`;
    await mongo(db => db.collection('components').deleteMany({key: depKey}));

    const sbom = {
      bomFormat: 'CycloneDX',
      specVersion: '1.4',
      version: 1,
      components: [{
        type: 'library',
        name,
        version: '7.0.3',
        purl: `pkg:npm/${name}@7.0.3`,
        hashes: [{alg: 'SHA-1', content: 'e4da4ddb5b772cd32cac4b9238158d88808a9f07'}],
      }],
    };

    const resp = await supertest(ROOT_URL).post(`${BASE}/core/imports/scan/cyclonedx`)
      .query({project: PROJECT, module: `cydx-hashes-mod-${unique}`, demo: true})
      .set('x-api-key', API_KEY)
      .send(sbom);
    expect(resp.status).toBe(StatusCodes.CREATED);

    await new Promise(r => setTimeout(r, 4000));

    const doc = await mongo(db => db.collection('components').findOne({key: depKey}));
    expect(doc).not.toBeNull();
    const v = (doc.versions || []).find(v => v.version === '7.0.3');
    expect(v).toBeDefined();
    expect(v.checksums).toEqual(expect.any(Array));
    const all = (v.checksums || []).map(c => c.checksum);
    console.log('cydx-hashes checksums on 7.0.3:', all);
    expect(all).toContain('e4da4ddb5b772cd32cac4b9238158d88808a9f07');
  }, 90000);

  it('ONE CycloneDX import: same component repeated for two versions → 1 doc, exactly one entry per distinct version', async () => {
    // CycloneDX hashes are propagated as `<alg>:<content>` (e.g. `sha1:...`). Version.findChecksum
    // dedups by algorithm prefix, so the second sha1 hash for the same version is treated as the
    // same checksum slot - what we assert here is the version-row dedup, not checksum accumulation.
    const unique = Date.now() + Math.floor(Math.random() * 1000);
    const name = `single-cydx-${unique}`;
    const depKey = `npm:${name}`;

    await mongo(db => db.collection('components').deleteMany({key: depKey}));

    const sbom = {
      bomFormat: 'CycloneDX',
      specVersion: '1.4',
      version: 1,
      components: [
        {type: 'library', name, version: '7.0.3', purl: `pkg:npm/${name}@7.0.3`, hashes: [{alg: 'SHA-1', content: 'a'.repeat(40)}]},
        {type: 'library', name, version: '7.0.3', purl: `pkg:npm/${name}@7.0.3`, hashes: [{alg: 'SHA-1', content: 'b'.repeat(40)}]},
        {type: 'library', name, version: '7.0.4', purl: `pkg:npm/${name}@7.0.4`, hashes: [{alg: 'SHA-1', content: 'c'.repeat(40)}]},
        {type: 'library', name, version: '7.0.4', purl: `pkg:npm/${name}@7.0.4`, hashes: [{alg: 'SHA-1', content: 'd'.repeat(40)}]},
      ],
    };

    const resp = await supertest(ROOT_URL).post(`${BASE}/core/imports/scan/cyclonedx`)
      .query({project: PROJECT, module: `single-cydx-mod-${unique}`, demo: true})
      .set('x-api-key', API_KEY)
      .send(sbom);
    expect(resp.status).toBe(StatusCodes.CREATED);

    await new Promise(r => setTimeout(r, 4000));

    const docs = await mongo(db => db.collection('components').find({key: depKey}).toArray());
    if (docs.length !== 1) {
      console.log('CYDX DUP DOCS:', JSON.stringify(docs, null, 2));
    }
    expect(docs).toHaveLength(1);

    const versions = docs[0].versions || [];
    console.log('versions:', JSON.stringify(versions.map(v => ({
      version: v.version,
      checksums: (v.checksums || []).map(c => c.checksum)
    })), null, 2));

    expect(versions.filter(v => v.version === '7.0.3')).toHaveLength(1);
    expect(versions.filter(v => v.version === '7.0.4')).toHaveLength(1);

    // All four distinct hashes must be persisted, even though two share each version row
    const allHexes = versions.flatMap(v => (v.checksums || []).map(c => (c.checksum || '').replace(/^[^:]*:/, '')));
    expect(allHexes).toEqual(expect.arrayContaining(['a','b','c','d'].map(ch => ch.repeat(40))));
  }, 90000);

  it('5 concurrent CycloneDX imports → 1 component doc, 1 version row, all 5 checksums preserved', async () => {
    const unique = Date.now() + Math.floor(Math.random() * 1000);
    const name = `race-cydx-${unique}`;
    const depKey = `npm:${name}`;
    const version = '7.0.3';

    await mongo(db => db.collection('components').deleteMany({key: depKey}));

    const buildSbom = (hashChar) => ({
      bomFormat: 'CycloneDX',
      specVersion: '1.4',
      version: 1,
      components: [{
        type: 'library',
        name,
        version,
        purl: `pkg:npm/${name}@${version}`,
        hashes: [{alg: 'SHA-1', content: hashChar.repeat(40)}],
      }],
    });

    const hashChars = ['a', 'b', 'c', 'd', 'e'];
    const expectedHexes = hashChars.map(ch => ch.repeat(40));
    const resps = await Promise.all(hashChars.map((ch, i) =>
      supertest(ROOT_URL).post(`${BASE}/core/imports/scan/cyclonedx`)
        .query({project: PROJECT, module: `race-cydx-mod-${unique}-${i}`, demo: true})
        .set('x-api-key', API_KEY)
        .send(buildSbom(ch))
    ));
    resps.forEach(r => expect(r.status).toBe(StatusCodes.CREATED));

    // wait for all deferred processScan runs to settle
    await new Promise(r => setTimeout(r, 5000));

    const docs = await mongo(db => db.collection('components').find({key: depKey}).toArray());
    expect(docs).toHaveLength(1);

    const v = (docs[0].versions || []).find(v => v.version === version);
    expect(v).toBeDefined();
    const storedHexes = (v.checksums || []).map(c => (c.checksum || '').replace(/^[^:]*:/, ''));
    console.log('checksums on 7.0.3:', v.checksums);
    expect(storedHexes).toEqual(expect.arrayContaining(expectedHexes));
  }, 90000);
});
