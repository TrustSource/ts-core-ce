// Scan hardening item C - the depth guard that turns a 500 into a 400. Item D, the analysis
// call that settles in every branch, is covered by worker-runner.unit.spec.js.
//
// Both are Meteor-free CommonJS so plain Jest can require them (`yarn meteor-test` does not
// boot on this checkout). The behaviour against a running server is in
// scan-depth-limit.spec.js.
const fs = require('fs');
const path = require('path');

const {
  MAX_SCAN_DEPENDENCY_DEPTH,
  MAX_STORABLE_DEPENDENCY_DEPTH,
  findDepthViolation,
  describeDepthViolation,
  MAX_SCAN_BODY_DEPTH,
  findBodyDepthViolation,
  describeBodyDepthViolation
} = require('../../imports/server/scan/dependencyDepth');
const {MAX_ECHOED_TEXT} = require('../../imports/server/scan/textLimits');

const REPO = path.join(__dirname, '..', '..');

/** Chain of n nested dependencies: dp0 -> dp1 -> ... -> dp(n-1). */
function chain(n) {
  let node = null;
  for (let i = n - 1; i >= 0; i--) {
    node = {name: 'dp' + i, key: 'npm:dp' + i, versions: ['1.0.0'],
      dependencies: node ? [node] : []};
  }
  return node ? [node] : [];
}

describe('#134 C - dependency depth guard', () => {
  // Criterion 18.
  it('exports the limit as a named constant', () => {
    expect(typeof MAX_SCAN_DEPENDENCY_DEPTH).toBe('number');
    expect(MAX_SCAN_DEPENDENCY_DEPTH).toBe(80);
  });

  it('counts a top-level element as depth 1 and a child as parent + 1', () => {
    expect(findDepthViolation(chain(1), 1)).toBeNull();
    expect(findDepthViolation(chain(2), 1)).toMatchObject({depth: 2, key: 'npm:dp1'});
    expect(findDepthViolation(chain(2), 2)).toBeNull();
  });

  it('accepts exactly the limit and rejects limit + 1', () => {
    expect(findDepthViolation(chain(MAX_SCAN_DEPENDENCY_DEPTH), MAX_SCAN_DEPENDENCY_DEPTH))
      .toBeNull();
    const violation = findDepthViolation(chain(MAX_SCAN_DEPENDENCY_DEPTH + 1),
      MAX_SCAN_DEPENDENCY_DEPTH);
    expect(violation).not.toBeNull();
    expect(violation.depth).toBe(MAX_SCAN_DEPENDENCY_DEPTH + 1);
    expect(violation.key).toBe('npm:dp' + MAX_SCAN_DEPENDENCY_DEPTH);
  });

  it('defaults to the published limit when none is passed', () => {
    expect(findDepthViolation(chain(MAX_SCAN_DEPENDENCY_DEPTH))).toBeNull();
    expect(findDepthViolation(chain(MAX_SCAN_DEPENDENCY_DEPTH + 1))).not.toBeNull();
  });

  // Criterion 22: the guard exists precisely for input a recursive walk would die on.
  it('handles a 10 000-level chain without blowing the stack', () => {
    const violation = findDepthViolation(chain(10000), MAX_SCAN_DEPENDENCY_DEPTH);
    expect(violation).not.toBeNull();
    expect(violation.depth).toBe(MAX_SCAN_DEPENDENCY_DEPTH + 1);
  });

  it('reports the first offender in depth-first order across several branches', () => {
    const deps = [
      {key: 'npm:shallow', dependencies: [{key: 'npm:shallow-kid', dependencies: []}]},
      chain(5)[0]
    ];
    expect(findDepthViolation(deps, 3)).toMatchObject({key: 'npm:dp3', depth: 4});
  });

  it('names the offending node when it carries no key', () => {
    const deps = chain(MAX_SCAN_DEPENDENCY_DEPTH + 1);
    let node = deps[0];
    while (node.dependencies && node.dependencies.length) { node = node.dependencies[0]; }
    delete node.key;
    node.purl = 'pkg:npm/deep@1.0.0';
    expect(findDepthViolation(deps, MAX_SCAN_DEPENDENCY_DEPTH).purl)
      .toBe('pkg:npm/deep@1.0.0');
  });

  it('tolerates junk where a dependency list is expected', () => {
    expect(findDepthViolation(undefined, 5)).toBeNull();
    expect(findDepthViolation([], 5)).toBeNull();
    expect(findDepthViolation([null, 'nope', 7], 5)).toBeNull();
    expect(findDepthViolation([{key: 'a', dependencies: 'not-an-array'}], 5)).toBeNull();
  });

  // Criterion 21: the description a client sees must name both the limit and the node.
  it('describes the violation with the limit and the offending node', () => {
    const violation = findDepthViolation(chain(MAX_SCAN_DEPENDENCY_DEPTH + 1));
    const description = describeDepthViolation(violation);
    expect(description).toContain(String(MAX_SCAN_DEPENDENCY_DEPTH));
    expect(description).toContain('npm:dp' + MAX_SCAN_DEPENDENCY_DEPTH);
  });

  // Replacement for criterion 23. An over-deep UI import is unreachable, because both
  // importers cap at MAX_DEPENDENCY_NESTING and re-parent the overflow; locking the
  // ordering is what keeps that unreachability true as the numbers get edited.
  it('stays between the importers cap and the largest depth Mongo will store', () => {
    const {MAX_DEPENDENCY_NESTING} = require('../../imports/lib/cyclonedx/reader');
    expect(MAX_DEPENDENCY_NESTING).toBeLessThanOrEqual(MAX_SCAN_DEPENDENCY_DEPTH);
    expect(MAX_SCAN_DEPENDENCY_DEPTH).toBeLessThanOrEqual(MAX_STORABLE_DEPENDENCY_DEPTH);
    // Measured against the running server, 2026-09-04: depth 89 inserts, 90 does not.
    expect(MAX_STORABLE_DEPENDENCY_DEPTH).toBe(89);
  });

  // The guard has to run before cleanAndValidateScan: that call recurses one frame per
  // level and SimpleSchema.clean walks the whole graph, so a pathological chain would
  // stack-overflow there and come back as the 500 this change exists to remove. It also
  // has to run before module resolution and the insert, which is what makes "no scan, no
  // module" true by construction rather than by cleanup.
  it('is wired into ingestScan before validation, module resolution and the insert', () => {
    const source = fs.readFileSync(
      path.join(REPO, 'imports', 'server', 'rest-api', 'scans.js'), 'utf8');
    const guard = source.indexOf('findDepthViolation(');
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(source.indexOf('helpers.cleanAndValidateScan('));
    expect(guard).toBeLessThan(source.indexOf('resolveModuleRef('));
    expect(guard).toBeLessThan(source.indexOf('Scans.insertAsync('));
  });

  // Finding 6: `name` has a `min` and no `max` in ApiDependencySchema, and the 400 body
  // repeats the identifier three times - `object`, `description` and `messages[0].message`.
  it('caps the identifier it carries into the response', () => {
    const huge = 'n'.repeat(400000);
    const deps = chain(MAX_SCAN_DEPENDENCY_DEPTH + 1);
    let node = deps[0];
    while (node.dependencies && node.dependencies.length) node = node.dependencies[0];
    node.name = huge;
    node.key = huge;
    node.purl = huge;

    const violation = findDepthViolation(deps);
    expect(violation.name.length).toBeLessThanOrEqual(MAX_ECHOED_TEXT);
    expect(violation.key.length).toBeLessThanOrEqual(MAX_ECHOED_TEXT);
    expect(violation.purl.length).toBeLessThanOrEqual(MAX_ECHOED_TEXT);
    expect(describeDepthViolation(violation).length)
      .toBeLessThan(MAX_ECHOED_TEXT + 200);
  });
});

// ── finding 1: the dependency chain was never the only way down ───────────────────────
describe('#134 C - the general body nesting backstop', () => {
  /** `{a:{a:...{leaf:1}}}` nested `n` deep. */
  function nested(n) {
    let value = {leaf: 1};
    for (let i = 0; i < n; i++) value = {a: value};
    return value;
  }

  it('accepts a body nested exactly at the limit and rejects one level more', () => {
    // body(0) -> junk(1) -> a(2) ... so `nested(limit - 1)` puts the leaf at `limit`.
    expect(findBodyDepthViolation({junk: nested(MAX_SCAN_BODY_DEPTH - 1)})).toBeNull();
    const violation = findBodyDepthViolation({junk: nested(MAX_SCAN_BODY_DEPTH)});
    expect(violation).not.toBeNull();
    expect(violation.depth).toBe(MAX_SCAN_BODY_DEPTH + 1);
  });

  // The two doors QA and the security review each opened against the running server: an
  // unknown top-level key (stripped by the schema, but only after MongoObject has walked
  // it) and a blackbox field inside a dependency (kept whole, and refused by BSON).
  it('catches nesting under an unknown key and under a dependency blackbox field', () => {
    expect(findBodyDepthViolation({project: 'p', junk: nested(2500)}).depth)
      .toBeGreaterThan(MAX_SCAN_BODY_DEPTH);
    const body = {dependencies: [{key: 'npm:a', meta: nested(2000)}]};
    const violation = findBodyDepthViolation(body);
    expect(violation).not.toBeNull();
    expect(violation.path).toMatch(/^dependencies\.0\.meta\./);
  });

  // Same contract as findDepthViolation, and for the same reason: the input this rejects
  // is exactly the input a recursive walk dies on.
  it('is iterative, so a 100 000-level body resolves instead of overflowing', () => {
    expect(() => findBodyDepthViolation({junk: nested(100000)})).not.toThrow();
    expect(findBodyDepthViolation({junk: nested(100000)}).depth)
      .toBe(MAX_SCAN_BODY_DEPTH + 1);
  });

  it('tolerates whatever is handed to it', () => {
    [null, undefined, 'a string', 7, []].forEach((value) => {
      expect(findBodyDepthViolation(value)).toBeNull();
    });
    expect(findBodyDepthViolation({a: 1, b: [1, 2, 'x'], c: null})).toBeNull();
  });

  // A path is what makes the message actionable, and every segment of it comes from the
  // payload, so both the segment count and the total length are bounded.
  it('names a bounded path built from the root end of the chain', () => {
    const violation = findBodyDepthViolation({['k'.repeat(5000)]: nested(300)});
    expect(violation.path.length).toBeLessThanOrEqual(MAX_ECHOED_TEXT);
    expect(violation.path.endsWith('...')).toBe(true);
    const description = describeBodyDepthViolation(violation);
    expect(description).toContain(String(MAX_SCAN_BODY_DEPTH));
    expect(description).toContain(String(violation.depth));
  });

  // The general limit must be unreachable by any dependency tree the dependency guard
  // lets through, or criteria 19-22 would start failing on a payload they accept: one
  // dependency level costs two generic levels.
  it('sits above the deepest legal dependency payload and below the BSON ceiling', () => {
    expect(MAX_SCAN_DEPENDENCY_DEPTH * 2).toBeLessThan(MAX_SCAN_BODY_DEPTH);
    expect(MAX_SCAN_BODY_DEPTH).toBeLessThanOrEqual(178);
    const legal = {project: 'p', module: 'm', dependencies: chain(MAX_SCAN_DEPENDENCY_DEPTH)};
    expect(findBodyDepthViolation(legal)).toBeNull();
  });

  it('is wired into ingestScan after the dependency guard and before validation', () => {
    const source = fs.readFileSync(
      path.join(REPO, 'imports', 'server', 'rest-api', 'scans.js'), 'utf8');
    const dependencyGuard = source.indexOf('findDepthViolation(body');
    const bodyGuard = source.indexOf('findBodyDepthViolation(body');
    expect(dependencyGuard).toBeGreaterThan(-1);
    expect(bodyGuard).toBeGreaterThan(dependencyGuard);
    expect(bodyGuard).toBeLessThan(source.indexOf('helpers.cleanAndValidateScan('));
    expect(bodyGuard).toBeLessThan(source.indexOf('resolveModuleRef('));
    expect(bodyGuard).toBeLessThan(source.indexOf('Scans.insertAsync('));
  });
});

// ── item C, criterion 24: the limit is part of the published contract ─────────────────
describe('#134 - the API contract documents both new behaviours', () => {
  it('names the nesting limit and the checksum drop on POST /core/scans', () => {
    const yaml = fs.readFileSync(path.join(REPO, 'public', 'api-v2', 'openapi.yaml'), 'utf8');
    const scansPath = yaml.slice(yaml.indexOf('\n  /core/scans:'),
      yaml.indexOf('\n  /core/scans/{scan_id}:'));
    const submit = scansPath.slice(scansPath.indexOf('summary: Submit scan'));
    expect(submit).toContain(String(MAX_SCAN_DEPENDENCY_DEPTH));
    // Both limits, or a client only learns about the one it did not hit.
    expect(submit).toContain(String(MAX_SCAN_BODY_DEPTH));
    expect(submit).toMatch(/nest/i);
    expect(submit).toMatch(/checksum/i);
  });
});
