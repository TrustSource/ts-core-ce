import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Analysis } from '../../../analysis/services/ModuleAnalyzer.js';
import { Vulnerability } from '../../../analysis/services/Vulnerability.js';
import { makeDependency } from '../helpers/fixtures.js';

// These tests pin the REJECTION-EVICTION / retry branch that the P1 refactor added
// to both caches - a path none of queryDedup.test.js's 4 happy-path tests exercise:
//   ModuleAnalyzer.getComponent:  promise.catch(() => { if (cache[key] === promise) delete cache[key]; })
//   Vulnerability.findAll:        cvesPromise.catch(() => { if (cache.get(k) === cvesPromise) cache.delete(k); })
// If a transient DB error were cached (rejection memoized), the entry would poison the
// cache forever and every later lookup for that key would keep failing. The invariant is:
// a failed lookup must be dropped so the NEXT call retries with a fresh query and can succeed,
// after which the successful result caches normally.

// db whose `components` lookup rejects on its FIRST call and resolves on every later call.
// The call index is captured at find() time so a concurrent second find() cannot shift it.
function flakyComponentsDb(fooDoc) {
  let componentFinds = 0;
  return {
    get componentFinds() { return componentFinds; },
    collection(name) {
      return {
        find() {
          let myCall = 0;
          if (name === 'components') { componentFinds++; myCall = componentFinds; }
          return {
            limit() { return this; },
            sort() { return this; },
            toArray() {
              if (name !== 'components') return Promise.resolve([]);
              return myCall === 1
                ? Promise.reject(new Error('transient db error'))
                : Promise.resolve([fooDoc]);
            }
          };
        }
      };
    }
  };
}

// db whose `cves` lookup rejects on its FIRST call and resolves on every later call.
function flakyCvesDb(vulnDoc) {
  let cvesFinds = 0;
  return {
    get cvesFinds() { return cvesFinds; },
    collection(name) {
      return {
        find() {
          let myCall = 0;
          if (name === 'cves') { cvesFinds++; myCall = cvesFinds; }
          return {
            limit() { return this; },
            sort() { return this; },
            toArray() {
              if (name !== 'cves') return Promise.resolve([]);
              return myCall === 1
                ? Promise.reject(new Error('transient cves error'))
                : Promise.resolve([vulnDoc]);
            }
          };
        }
      };
    }
  };
}

describe('Integration: cache rejection eviction + retry (componentCache + cvesCache)', () => {
  it('componentCache: a rejected component lookup is evicted, so a later getComponent retries and then caches', async () => {
    const fooDoc = { _id: 'X', key: 'npm:foo', versions: [{ version: '1.0.0' }], private: false };
    const db = flakyComponentsDb(fooDoc);
    const analysis = new Analysis('COMPANY_1', 'MODULE_1', false, null);
    const dep = makeDependency('npm:foo', '1.0.0');

    // 1st call: the underlying lookup rejects, so the shared (in-flight) promise rejects.
    await assert.rejects(
      analysis.getComponent(db, 'npm:foo', {}, false, dep, {}, {}),
      /transient db error/,
      'a rejected loadComponent must surface as a rejected getComponent'
    );

    // 2nd call: because the rejected entry was evicted, this RETRIES with a fresh query and
    // succeeds. If the rejection had been cached instead, this await would throw again.
    const comp = await analysis.getComponent(db, 'npm:foo', {}, false, dep, {}, {});
    assert.equal(db.componentFinds, 2, 'retry after a rejected lookup must issue a second components query');
    assert.equal(comp.key, 'npm:foo');

    // 3rd call: the successful lookup is now memoized -> no new query, same object back.
    const comp2 = await analysis.getComponent(db, 'npm:foo', {}, false, dep, {}, {});
    assert.equal(db.componentFinds, 2, 'a successful lookup must be cached (no third components query)');
    assert.equal(comp2, comp, 'cached getComponent returns the memoized component');
  });

  it('cvesCache: a rejected cves lookup is evicted, so a later findAll retries instead of reusing the failure', async () => {
    const cvesCache = new Map();
    const vulnDoc = {
      key: 'npm:foo',
      versions: [{
        version: '1.0.0',
        confidence: 'HIGH',
        vulns: [{ vuln_ids: ['CVE-2021-1'], impact: { cvss3: { baseScore: 8.8, vectorString: 'CVSS:3.1/AV:N' } } }]
      }]
    };
    const db = flakyCvesDb(vulnDoc);

    // 1st findAll: the cves lookup rejects; findAll swallows the error and returns [] (no manual vulns).
    const first = await Vulnerability.findAll(db, 'npm:foo', ['1.0.0'], 'COMPANY_1', [], cvesCache);
    assert.deepEqual(first, [], 'a rejected cves lookup yields an empty result for that call');

    // 2nd findAll (identical cacheKey): the rejected entry was evicted, so it retries with a fresh
    // query that now succeeds and surfaces the vulnerability. A cached rejection would return [] again.
    const second = await Vulnerability.findAll(db, 'npm:foo', ['1.0.0'], 'COMPANY_1', [], cvesCache);
    assert.equal(db.cvesFinds, 2, 'retry after a rejected cves lookup must issue a second cves query');
    assert.equal(second.length, 1, 'the retry must surface the vulnerability from the successful lookup');
    assert.equal(second[0].vuln.name, 'CVE-2021-1');
  });
});
