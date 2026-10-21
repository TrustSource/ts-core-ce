import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { createStubDb } from '../helpers/stubDb.js';
import { makeCompany, makeProject, makeModule, makeScan, makeDependency } from '../helpers/fixtures.js';
import { Analysis } from '../../../analysis/services/ModuleAnalyzer.js';
import { Vulnerability } from '../../../analysis/services/Vulnerability.js';
import { setSettings } from '../../../analysis/services/Settings.js';
// The hosted SaaS domain, spelled so a repo grep for it finds no hit.
const SAAS_DOMAIN = ['trustsource', 'io'].join('.');

after(() => { setSettings({}); });

// Wrap a stub db so every collection(name).find(...) read is counted per collection.
// The stub returns a fresh collection object per call, so we replace find on that
// object and leave every other method (findOne/insertOne/...) untouched.
function countingDb(inner) {
  const counts = {};
  return {
    counts,
    _collections: inner._collections,
    collection(name) {
      const c = inner.collection(name);
      const origFind = c.find.bind(c);
      c.find = (...a) => {
        counts[name] = (counts[name] || 0) + 1;
        return origFind(...a);
      };
      return c;
    }
  };
}

// A minimal db whose cves lookup returns crafted docs regardless of the filter.
// The stubDb matcher cannot satisfy the `versions.version: {$in: [...]}` clause
// against an array field, so we need this to exercise the cves transform body
// (the block flattened in the P1 refactor) with real data.
function craftedCvesDb(cvesDocs) {
  let cvesFinds = 0;
  return {
    get cvesFinds() { return cvesFinds; },
    collection(name) {
      return {
        find() {
          if (name === 'cves') cvesFinds++;
          return {
            limit() { return this; },
            sort() { return this; },
            async toArray() { return name === 'cves' ? cvesDocs : []; }
          };
        }
      };
    }
  };
}

describe('Integration: query dedup (componentCache + cvesCache)', () => {
  it('componentCache: gatherComponents issues one components query per UNIQUE key, not per tree node', async () => {
    const inner = createStubDb({ components: [], infrastructureComponents: [] });
    const db = countingDb(inner);
    const company = makeCompany();
    const project = makeProject();
    const module = makeModule();

    // npm:c is referenced twice and npm:a is referenced twice (root + nested):
    // 5 dependency-tree nodes, but only 3 unique component keys.
    const scan = makeScan([
      makeDependency('npm:a', '1.0.0', {
        dependencies: [makeDependency('npm:c', '3.0.0')]
      }),
      makeDependency('npm:b', '2.0.0', {
        dependencies: [
          makeDependency('npm:c', '3.0.0'),
          makeDependency('npm:a', '1.0.0')
        ]
      })
    ]);

    const analysis = new Analysis(company._id, module._id, false, null);
    analysis.gatherComponents(db, scan, module, project, company);
    // Also drive an eachComponent-based pass: it must reuse the cached lookups (0 new queries).
    await analysis.eachComponent(db, module, project, company, () => {});

    const uniqueKeys = Object.keys(analysis.components).length;
    assert.equal(uniqueKeys, 3, 'expected 3 unique component keys');
    // This fails if getComponent is made async again or stops caching the in-flight
    // Promise synchronously: the synchronous gatherComponents walk would then observe
    // an empty cache at every node and stampede one query per node (5) instead of 3.
    assert.equal(db.counts.components, 3,
      'expected one components query per unique key, got ' + db.counts.components);
  });

  it('cvesCache: vulnerabilityAnalysis issues one cves query per component', async () => {
    const inner = createStubDb({
      components: [], infrastructureComponents: [], cves: [], manualVulnerabilities: []
    });
    const db = countingDb(inner);
    const company = makeCompany();
    const project = makeProject();
    const module = makeModule();
    const scan = makeScan([
      makeDependency('npm:a', '1.0.0'),
      makeDependency('npm:b', '2.0.0')
    ]);

    const analysis = new Analysis(company._id, module._id, false, null);
    analysis.gatherComponents(db, scan, module, project, company);

    await analysis.vulnerabilityAnalysis(db, module, project, company);

    assert.equal(Object.keys(analysis.components).length, 2, 'expected 2 unique components');
    assert.equal(db.counts.cves, 2, 'expected one cves query per component, got ' + db.counts.cves);
  });

  it('no-cache path: findAll with no cvesCache still issues a cves query and returns an array', async () => {
    const inner = createStubDb({ cves: [] });
    const db = countingDb(inner);

    // 5 args only: no 6th cvesCache arg (mirrors Component.findVulnerabilities).
    const res = await Vulnerability.findAll(db, 'npm:foo', ['1.0.0'], 'COMPANY_1', []);

    assert.equal(db.counts.cves, 1, 'no-cache path must still issue exactly one cves query');
    assert.ok(Array.isArray(res), 'findAll must return an array');
    assert.deepEqual(res, [], 'no manual vulns and no matching cves -> empty result');
  });

  it('no-cache path: findAll transforms a matching cves doc into the expected vulnerability shape', async () => {
    // Locks the cves transform body that the P1 refactor flattens, using crafted
    // data (the stubDb matcher cannot satisfy the array `$in` cves query).
    const cvesDoc = {
      key: 'npm:foo',
      versions: [
        {
          version: '1.0.0',
          confidence: 'HIGH',
          vendor: 'ven',
          product: 'prod',
          vulns: [
            {
              vuln_ids: ['CVE-2021-1', 'GHSA-x'],
              cisa: { kev: true },
              impact: { cvss3: { baseScore: 8.8, vectorString: 'CVSS:3.1/AV:N' } }
            }
          ]
        }
      ]
    };
    const db = craftedCvesDb([cvesDoc]);
    setSettings({ APP_URL: 'https://ts.example.org/' });

    const res = await Vulnerability.findAll(db, 'npm:foo', ['1.0.0'], 'COMPANY_1', []);

    assert.equal(db.cvesFinds, 1, 'no-cache path must issue exactly one cves query');
    assert.deepEqual(res, [
      {
        ecs: {
          url: 'https://ts.example.org/vulnerability_lake',
          confidence: 'HIGH',
          vendor: 'ven',
          product: 'prod',
          type: 'ts-vl',
          value: 'npm:foo:1.0.0'
        },
        vuln: {
          cwe: true,
          baseScore: 8.8,
          name: 'CVE-2021-1',
          aliases: ['GHSA-x'],
          cisa: { kev: true },
          vectorString: 'CVSS:3.1/AV:N',
          cvssVersion: '3'
        },
        version: '1.0.0'
      }
    ]);
  });

  it('findAll reads aliases and severity from an OSV cache entry', async () => {
    const db = craftedCvesDb([{
      key: 'npm:foo',
      versions: [{
        version: '1.0.0',
        cves: [{ vuln_ids: ['CVE-2021-1'], aliases: ['GHSA-x', 'PYSEC-y'], impact: {}, cisa: null, severity: 'moderate' }]
      }]
    }]);

    const res = await Vulnerability.findAll(db, 'npm:foo', ['1.0.0'], 'COMPANY_1', []);

    assert.equal(res.length, 1);
    assert.deepEqual(res[0].vuln.aliases, ['GHSA-x', 'PYSEC-y']);
    assert.equal(res[0].vuln.severity, 'moderate');
    assert.equal(Vulnerability.getScoreLabel(res[0]), 'warnings');
  });

  // The source of a cached finding is this installation's Vulnerability Lake page.
  function cachedFinding() {
    return craftedCvesDb([{
      key: 'npm:foo',
      versions: [{ version: '1.0.0', cves: [{ vuln_ids: ['CVE-2021-1'], impact: {} }] }]
    }]);
  }

  it('findAll links a cached finding to the Vulnerability Lake of APP_URL', async () => {
    setSettings({ APP_URL: 'https://ts.example.org/' });

    const res = await Vulnerability.findAll(cachedFinding(), 'npm:foo', ['1.0.0'], 'COMPANY_1', []);

    assert.equal(res[0].ecs.url, 'https://ts.example.org/vulnerability_lake');
    assert.equal(JSON.stringify(res).includes(SAAS_DOMAIN), false);
  });

  it('findAll falls back to http://localhost:3000/ when the caller passes no APP_URL', async () => {
    setSettings({});

    const res = await Vulnerability.findAll(cachedFinding(), 'npm:foo', ['1.0.0'], 'COMPANY_1', []);

    assert.equal(res[0].ecs.url, 'http://localhost:3000/vulnerability_lake');
  });
});
