import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createStubDb } from '../helpers/stubDb.js';
import { startFakeOsv, osvRecord } from '../helpers/fakeOsv.js';
import { osvSync } from '../../../analysis/services/osv/sync.js';
import { pairId } from '../../../analysis/services/osv/queries.js';

const V31 = 'CVSS:3.1/AV:N/AC:L/PR:H/UI:N/S:U/C:H/I:H/A:H';
const NOW = new Date('2026-09-18T10:00:00Z');
const LODASH = pairId('npm:lodash', '4.17.20');
const LEFTPAD = pairId('npm:left-pad', '1.0.0');

let osv;

function components() {
  return {
    'npm:lodash': { key: 'npm:lodash', versions: [{ version: '4.17.20' }] },
    'npm:left-pad': { key: 'npm:left-pad', versions: [{ version: '1.0.0' }] }
  };
}

function run(db, extra = {}) {
  return osvSync(db, Object.assign({
    components: components(),
    purls: new Map(),
    skip: () => false,
    settings: { TS_OSV_ENABLED: true, OSV_API_URL: osv.baseUrl },
    now: NOW
  }, extra));
}

function cvesDoc(db, id) {
  return db._collections.cves.find(doc => doc._id === id);
}

before(async () => { osv = await startFakeOsv(); });
after(async () => { await osv.close(); });
beforeEach(() => {
  osv.state.lists.clear();
  osv.state.records.clear();
  osv.state.requests.length = 0;
  osv.state.failQuerybatch = false;
  osv.state.reply = null;
  osv.state.lists.set('npm/lodash@4.17.20', [
    { id: 'GHSA-35jh-r3h4-6jhm', modified: '2026-09-10T03:49:04.067984Z' },
    { id: 'GHSA-29mw-wpgm-hmr9', modified: '2025-09-29T21:12:31.102523Z' }
  ]);
  osv.state.records.set('GHSA-35jh-r3h4-6jhm', osvRecord('GHSA-35jh-r3h4-6jhm',
    { aliases: ['CVE-2021-23337'], vector: V31, label: 'HIGH', cwe: ['CWE-77'] }));
  osv.state.records.set('GHSA-29mw-wpgm-hmr9', osvRecord('GHSA-29mw-wpgm-hmr9',
    { aliases: ['CVE-2020-28500'], label: 'MODERATE', modified: '2025-09-29T21:12:31.102523451Z' }));
});

describe('Integration: osvSync', () => {
  it('does nothing unless the runner switched it on', async () => {
    const db = createStubDb({ cves: [], osvVulns: [] });

    for (const settings of [undefined, {}, { TS_OSV_ENABLED: 'true' }, { TS_OSV_ENABLED: false }]) {
      assert.deepEqual(await run(db, { settings }), { queries: 0, fetched: 0, written: 0 });
    }
    assert.equal(osv.state.requests.length, 0);
    assert.equal(db._collections.cves.length, 0);
  });

  it('fills an empty cache: records into osvVulns, one cves document per pair', async () => {
    const db = createStubDb({ cves: [], osvVulns: [] });

    const stats = await run(db);

    assert.deepEqual(stats, { queries: 2, fetched: 2, written: 2 });
    assert.deepEqual(db._collections.osvVulns.map(doc => doc._id).sort(), ['GHSA-29mw-wpgm-hmr9', 'GHSA-35jh-r3h4-6jhm']);
    assert.equal(db._collections.osvVulns.find(doc => doc._id === 'GHSA-35jh-r3h4-6jhm').listedModified,
      '2026-09-10T03:49:04.067984Z');
    assert.deepEqual(cvesDoc(db, LODASH), {
      _id: LODASH,
      key: 'npm:lodash',
      source: 'osv',
      versions: [{
        version: '4.17.20',
        checkedAt: NOW,
        // An exact package and version match: the highest confidence (1), as manual findings have.
        confidence: 1,
        cves: [
          { vuln_ids: ['CVE-2020-28500'], aliases: ['GHSA-29mw-wpgm-hmr9'], osv_ids: ['GHSA-29mw-wpgm-hmr9'],
            impact: {}, cisa: null, severity: 'moderate' },
          { vuln_ids: ['CVE-2021-23337'], aliases: ['GHSA-35jh-r3h4-6jhm'], osv_ids: ['GHSA-35jh-r3h4-6jhm'],
            impact: { cvss3: { vectorString: V31, version: '3.1', baseScore: 7.2, impactScore: 5.9, exploitScore: 1.2 } },
            cisa: null, severity: 'high' }
        ]
      }]
    });
    assert.deepEqual(cvesDoc(db, LEFTPAD).versions[0].cves, []);
  });

  it('re-asks OSV on the next analysis but fetches no unchanged record', async () => {
    const db = createStubDb({ cves: [], osvVulns: [] });
    await run(db);
    osv.state.requests.length = 0;

    const stats = await run(db, { now: new Date('2026-09-19T10:00:00Z') });

    assert.deepEqual(stats, { queries: 2, fetched: 0, written: 2 });
    assert.equal(osv.querybatchCalls().length, 1);
    assert.equal(osv.recordCalls().length, 0);
    assert.deepEqual(cvesDoc(db, LODASH).versions[0].checkedAt, new Date('2026-09-19T10:00:00Z'));
  });

  it('fetches only the record whose listed modified value changed', async () => {
    const db = createStubDb({ cves: [], osvVulns: [] });
    await run(db);
    osv.state.requests.length = 0;
    osv.state.lists.set('npm/lodash@4.17.20', [
      { id: 'GHSA-35jh-r3h4-6jhm', modified: '2026-09-11T00:00:00.000000Z' },
      { id: 'GHSA-29mw-wpgm-hmr9', modified: '2025-09-29T21:12:31.102523Z' }
    ]);

    await run(db);

    assert.deepEqual(osv.recordCalls().map(call => call.url), ['/vulns/GHSA-35jh-r3h4-6jhm']);
  });

  it('keeps a pair\'s previous document when the fetch cap left one of its records out', async () => {
    const previous = { _id: LODASH, key: 'npm:lodash', source: 'osv', versions: [{ version: '4.17.20', cves: [{ vuln_ids: ['OLD-1'] }] }] };
    const db = createStubDb({ cves: [previous], osvVulns: [] });

    const stats = await run(db, { fetchMax: 1 });

    assert.equal(stats.fetched, 1);
    assert.deepEqual(cvesDoc(db, LODASH), previous);
    assert.deepEqual(cvesDoc(db, LEFTPAD).versions[0].cves, []);
  });

  it('keeps every previous document when querybatch fails, and does not throw', async () => {
    const previous = { _id: LODASH, key: 'npm:lodash', source: 'osv', versions: [{ version: '4.17.20', cves: [{ vuln_ids: ['OLD-1'] }] }] };
    const db = createStubDb({ cves: [previous], osvVulns: [] });
    osv.state.failQuerybatch = true;

    const stats = await run(db);

    assert.deepEqual(stats, { queries: 2, fetched: 0, written: 0 });
    assert.deepEqual(db._collections.cves, [previous]);
  });

  it('does not rewrite a pair whose record could not be fetched', async () => {
    const db = createStubDb({ cves: [], osvVulns: [] });
    osv.state.records.delete('GHSA-29mw-wpgm-hmr9');

    await run(db);

    assert.equal(cvesDoc(db, LODASH), undefined);
    assert.ok(cvesDoc(db, LEFTPAD));
  });

  it('drops withdrawn records from the pair but still writes it', async () => {
    const db = createStubDb({ cves: [], osvVulns: [] });
    osv.state.records.set('GHSA-29mw-wpgm-hmr9', osvRecord('GHSA-29mw-wpgm-hmr9',
      { aliases: ['CVE-2020-28500'], withdrawn: '2026-01-01T00:00:00Z' }));

    await run(db);

    assert.deepEqual(cvesDoc(db, LODASH).versions[0].cves.map(entry => entry.vuln_ids[0]), ['CVE-2021-23337']);
  });

  it('asks nothing and writes nothing when the time budget is already spent', async () => {
    const db = createStubDb({ cves: [], osvVulns: [] });

    const stats = await run(db, { budgetMs: 0 });

    assert.equal(stats.written, 0);
    assert.equal(osv.state.requests.length, 0);
  });

  it('skips whitelisted components', async () => {
    const db = createStubDb({ cves: [], osvVulns: [] });

    const stats = await run(db, { skip: key => key === 'npm:lodash' });

    assert.equal(stats.queries, 1);
    assert.equal(cvesDoc(db, LODASH), undefined);
  });
});
