/* eslint-disable no-undef */
// Applying a manually resolved license to an ARBITRARY node of a
// stored scan, which is the generalisation of the earlier root-only machinery
// (imports/server/scan/rootDependency.js).
//
// Two properties carry the whole feature and are asserted hard below.
//
//  * AC17 - NO LEAK. The injected entry is MARKED, and every write path onto the
//    globally shared `components` catalogue already filters marked entries
//    (processScan.js:373, :459, :529). Widening the marker predicate is what buys
//    that for free; root-component-license.unit.spec.js asserts the other half.
//
//  * NON-DESTRUCTIVE. `reprocessScan` reads the STORED scan and no original
//    payload is retained anywhere, so replacing a node's licenses wholesale would
//    permanently destroy the scanner's own declaration. Ours goes in FRONT of
//    what the scanner declared, and only previously-injected entries are dropped
//    (AC16 - no accumulation).
const {
  resolvedLicenseMap,
  resolvedLicenseKeys,
  injectResolvedLicenses
} = require('../../imports/server/scan/componentLicensePick');
const {
  COMPONENT_LICENSE_ORIGIN,
  ROOT_LICENSE_ORIGIN,
  componentPickLicense,
  rootPickLicense,
  isInjectedLicense
} = require('../../imports/server/scan/rootDependency');
const {MAX_STORABLE_DEPENDENCY_DEPTH} =
  require('../../imports/server/scan/dependencyDepth');

function resolution(key, license, justification) {
  return {key, license, comment: 'License set manually',
    justification: justification === undefined ? 'because' : justification};
}

function moduleWith(entries) {
  return {componentConfig: {licensesSelected: entries}};
}

describe('resolvedLicenseMap', () => {
  it('collects ONLY entries carrying a justification', () => {
    // The discriminator. A multi-license-modal pick and a root-picker pick live
    // in the same array and must not be injected per-node by this feature.
    const module = moduleWith([
      resolution('npm:a', 'MIT'),
      {key: 'npm:b', license: 'Apache-2.0', comment: 'multi-license modal'},
      {key: 'npm:c', license: 'ISC', comment: 'root picker'}
    ]);
    expect([...resolvedLicenseMap(module).keys()]).toEqual(['npm:a']);
  });

  it('defaults the display name to the license key', () => {
    const map = resolvedLicenseMap(moduleWith([resolution('npm:a', 'PRIV-1')]));
    expect(map.get('npm:a')).toEqual({license: 'PRIV-1', name: 'PRIV-1'});
  });

  it('takes a resolved display name when one is supplied', () => {
    // The interactor resolves names with ONE Licenses query and hands them in;
    // this module never touches the database.
    const map = resolvedLicenseMap(moduleWith([resolution('npm:a', 'MIT')]),
      {MIT: 'MIT License'});
    expect(map.get('npm:a')).toEqual({license: 'MIT', name: 'MIT License'});
  });

  it('ignores an inherited member name in the supplied name lookup', () => {
    const map = resolvedLicenseMap(moduleWith([resolution('npm:a', 'constructor')]), {});
    expect(map.get('npm:a').name).toBe('constructor');
  });

  it('skips entries with no key or no license', () => {
    const map = resolvedLicenseMap(moduleWith([
      {license: 'MIT', justification: 'x', comment: 'c'},
      {key: 'npm:b', justification: 'x', comment: 'c'},
      {key: 7, license: 'MIT', justification: 'x', comment: 'c'},
      resolution('npm:ok', 'MIT')
    ]));
    expect([...map.keys()]).toEqual(['npm:ok']);
  });

  it('treats a blank justification as not ours', () => {
    expect(resolvedLicenseMap(moduleWith([resolution('npm:a', 'MIT', '   ')])).size).toBe(0);
    expect(resolvedLicenseMap(moduleWith([resolution('npm:a', 'MIT', '')])).size).toBe(0);
  });

  it('survives a malformed module document', () => {
    [null, undefined, {}, {componentConfig: null},
      {componentConfig: {licensesSelected: 'nope'}},
      {componentConfig: {licensesSelected: [null, 7, 'x']}}].forEach((m) => {
      expect(resolvedLicenseMap(m).size).toBe(0);
    });
  });

  it('is a Map, so a component keyed `__proto__` cannot poison the lookup', () => {
    const map = resolvedLicenseMap(moduleWith([resolution('__proto__', 'MIT')]));
    expect(map instanceof Map).toBe(true);
    expect(map.get('__proto__').license).toBe('MIT');
    expect(map.get('npm:anything-else')).toBeUndefined();
  });
});

describe('resolvedLicenseKeys', () => {
  // The license keys the caller has to look display names up for. Exists so the
  // wrapper in processScan.js does not have to build the map twice, nor restate
  // the "carries a justification" filter a second time in a second place.
  it('is the distinct license keys of the resolutions, sorted', () => {
    expect(resolvedLicenseKeys(moduleWith([
      resolution('npm:a', 'MIT'),
      resolution('npm:b', 'MIT'),
      resolution('npm:c', 'Apache-2.0')
    ]))).toEqual(['Apache-2.0', 'MIT']);
  });

  it('applies the same discriminator as resolvedLicenseMap', () => {
    expect(resolvedLicenseKeys(moduleWith([
      {key: 'npm:a', license: 'MIT', comment: 'multi-license modal'},
      resolution('npm:b', 'ISC')
    ]))).toEqual(['ISC']);
  });

  it('is empty for a module with no resolutions or a malformed document', () => {
    [null, undefined, {}, moduleWith([]), {componentConfig: {licensesSelected: 'nope'}}]
      .forEach((m) => expect(resolvedLicenseKeys(m)).toEqual([]));
  });
});

describe('injectResolvedLicenses', () => {
  function scanOf(dependencies) {
    return {_id: 's1', dependencies};
  }

  it('unshifts a MARKED entry onto the resolved node (AC17)', () => {
    const node = {key: 'npm:left-pad', licenses: []};
    const scan = scanOf([{key: 'npm:app', dependencies: [node]}]);
    const result = injectResolvedLicenses(scan, resolvedLicenseMap(
      moduleWith([resolution('npm:left-pad', 'MIT')]), {MIT: 'MIT License'}), 'npm:app');
    expect(node.licenses).toEqual([
      {key: 'MIT', name: 'MIT License', origin: COMPONENT_LICENSE_ORIGIN}]);
    expect(isInjectedLicense(node.licenses[0])).toBe(true);
    expect(result).toEqual({nodes: 1, keys: ['npm:left-pad']});
  });

  it('uses its OWN origin, not the root one', () => {
    // Sibling markers, not a reused one: the two injections have different
    // rules (the root's is replaced wholesale, ours is unshifted) and telling
    // them apart in a stored scan matters.
    expect(COMPONENT_LICENSE_ORIGIN).toBe('ts-component-pick');
    expect(ROOT_LICENSE_ORIGIN).toBe('ts-root-pick');
    expect(COMPONENT_LICENSE_ORIGIN).not.toBe(ROOT_LICENSE_ORIGIN);
  });

  it('KEEPS what the scanner declared, in front of it', () => {
    // Non-destructive. reprocessScan reads the stored scan and nothing retains
    // the original payload, so a wholesale replace is irreversible.
    const declared = {name: 'Apache-2.0'};
    const node = {key: 'npm:left-pad', licenses: [declared]};
    injectResolvedLicenses(scanOf([node]), resolvedLicenseMap(
      moduleWith([resolution('npm:left-pad', 'MIT')])), null);
    expect(node.licenses).toHaveLength(2);
    expect(node.licenses[1]).toBe(declared);
    expect(node.licenses[0].origin).toBe(COMPONENT_LICENSE_ORIGIN);
  });

  it('does not accumulate markers across runs (AC16)', () => {
    // The scan is persisted, so the next run walks over the previous injection.
    const node = {key: 'npm:left-pad',
      licenses: [componentPickLicense('ISC'), {name: 'Apache-2.0'},
        componentPickLicense('BSD-3-Clause')]};
    injectResolvedLicenses(scanOf([node]), resolvedLicenseMap(
      moduleWith([resolution('npm:left-pad', 'MIT')])), null);
    expect(node.licenses).toEqual([
      {key: 'MIT', name: 'MIT', origin: COMPONENT_LICENSE_ORIGIN},
      {name: 'Apache-2.0'}]);
  });

  it('also clears a stale ROOT-pick marker from a node it takes over', () => {
    // A component that used to be the root of its scan can carry one. Both
    // origins are "ours", so both are dropped before the fresh entry goes in.
    const node = {key: 'npm:left-pad', licenses: [rootPickLicense('ISC')]};
    injectResolvedLicenses(scanOf([node]), resolvedLicenseMap(
      moduleWith([resolution('npm:left-pad', 'MIT')])), null);
    expect(node.licenses).toEqual([
      {key: 'MIT', name: 'MIT', origin: COMPONENT_LICENSE_ORIGIN}]);
  });

  it('creates the licenses array when the node has none', () => {
    // The exact state the feature exists for: the scan detected nothing.
    const node = {key: 'npm:left-pad'};
    injectResolvedLicenses(scanOf([node]), resolvedLicenseMap(
      moduleWith([resolution('npm:left-pad', 'MIT')])), null);
    expect(node.licenses).toEqual([
      {key: 'MIT', name: 'MIT', origin: COMPONENT_LICENSE_ORIGIN}]);
  });

  it('replaces a non-array licenses value rather than throwing', () => {
    const node = {key: 'npm:left-pad', licenses: 'MIT'};
    injectResolvedLicenses(scanOf([node]), resolvedLicenseMap(
      moduleWith([resolution('npm:left-pad', 'MIT')])), null);
    expect(Array.isArray(node.licenses)).toBe(true);
    expect(node.licenses).toHaveLength(1);
  });

  it('applies to EVERY occurrence of the component in the tree (decision 4)', () => {
    // Resolution scope is (module, component key), not (module, path).
    const a = {key: 'npm:left-pad'};
    const b = {key: 'npm:left-pad'};
    const scan = scanOf([{key: 'npm:app', dependencies: [
      {key: 'npm:x', dependencies: [a]},
      {key: 'npm:y', dependencies: [b]}
    ]}]);
    const result = injectResolvedLicenses(scan, resolvedLicenseMap(
      moduleWith([resolution('npm:left-pad', 'MIT')])), 'npm:app');
    expect(result.nodes).toBe(2);
    expect(result.keys).toEqual(['npm:left-pad']);
    expect(a.licenses[0].key).toBe('MIT');
    expect(b.licenses[0].key).toBe('MIT');
  });

  it('NEVER touches the node identified by rootKey', () => {
    // applyRootLicense owns the root from the same storage slot and runs right
    // after this, producing the same license marked ts-root-pick. Two writers on
    // one node would fight.
    const root = {key: 'npm:app', licenses: [{name: 'Apache-2.0'}], dependencies: []};
    const scan = scanOf([root]);
    const result = injectResolvedLicenses(scan, resolvedLicenseMap(
      moduleWith([resolution('npm:app', 'MIT')])), 'npm:app');
    expect(root.licenses).toEqual([{name: 'Apache-2.0'}]);
    expect(result).toEqual({nodes: 0, keys: []});
  });

  it('still applies to a non-root node when the root is ALSO resolved', () => {
    const root = {key: 'npm:app', licenses: []};
    const child = {key: 'npm:left-pad', licenses: []};
    root.dependencies = [child];
    injectResolvedLicenses(scanOf([root]), resolvedLicenseMap(moduleWith([
      resolution('npm:app', 'ROOT-PRIV'), resolution('npm:left-pad', 'MIT')])), 'npm:app');
    expect(root.licenses).toEqual([]);
    expect(child.licenses[0].key).toBe('MIT');
  });

  it('applies to a node named like the root when there IS no root', () => {
    // findRootDependency returns null for a flat list of several childless
    // entries, so the caller passes rootKey = undefined - and nothing is skipped.
    const node = {key: 'npm:app', licenses: []};
    const result = injectResolvedLicenses(scanOf([node, {key: 'npm:b'}, {key: 'npm:c'}]),
      resolvedLicenseMap(moduleWith([resolution('npm:app', 'MIT')])), undefined);
    expect(result.nodes).toBe(1);
    expect(node.licenses[0].key).toBe('MIT');
  });

  it('leaves unresolved nodes completely alone', () => {
    const other = {key: 'npm:other', licenses: [{name: 'ISC'}]};
    const bare = {key: 'npm:bare'};
    injectResolvedLicenses(scanOf([other, bare]), resolvedLicenseMap(
      moduleWith([resolution('npm:left-pad', 'MIT')])), null);
    expect(other.licenses).toEqual([{name: 'ISC'}]);
    expect(bare.licenses).toBeUndefined();
  });

  it('reports nothing and writes nothing for an empty map', () => {
    const node = {key: 'npm:left-pad', licenses: []};
    expect(injectResolvedLicenses(scanOf([node]), new Map(), null))
      .toEqual({nodes: 0, keys: []});
    expect(node.licenses).toEqual([]);
  });

  it('survives a malformed scan', () => {
    const map = resolvedLicenseMap(moduleWith([resolution('npm:a', 'MIT')]));
    [null, undefined, {}, {dependencies: null}, {dependencies: 'nope'},
      {dependencies: [null, 7, 'x']},
      {dependencies: [{key: 'npm:a', dependencies: 'nope'}]}].forEach((scan) => {
      expect(() => injectResolvedLicenses(scan, map, null)).not.toThrow();
    });
  });

  it('reports the keys it applied, sorted and deduplicated', () => {
    const scan = scanOf([
      {key: 'npm:z'}, {key: 'npm:a'}, {key: 'npm:z'}
    ]);
    const result = injectResolvedLicenses(scan, resolvedLicenseMap(moduleWith([
      resolution('npm:z', 'MIT'), resolution('npm:a', 'ISC')])), null);
    expect(result.keys).toEqual(['npm:a', 'npm:z']);
    expect(result.nodes).toBe(3);
  });

  it('does not recurse past the storable depth bound', () => {
    // Guards a cyclic or pathologically deep stored scan; the bound is the one
    // the ingest path already publishes, not a fresh number.
    expect(MAX_STORABLE_DEPENDENCY_DEPTH).toBe(89);
    const leaf = {key: 'npm:deep', licenses: []};
    let node = leaf;
    for (let i = 0; i < MAX_STORABLE_DEPENDENCY_DEPTH + 20; i++) {
      node = {key: 'npm:n' + i, dependencies: [node]};
    }
    const map = resolvedLicenseMap(moduleWith([resolution('npm:deep', 'MIT')]));
    expect(() => injectResolvedLicenses(scanOf([node]), map, null)).not.toThrow();
    expect(leaf.licenses).toEqual([]);
  });

  it('terminates on a cyclic dependency graph', () => {
    const a = {key: 'npm:a', licenses: []};
    const b = {key: 'npm:b', dependencies: [a]};
    a.dependencies = [b];
    const map = resolvedLicenseMap(moduleWith([resolution('npm:a', 'MIT')]));
    expect(() => injectResolvedLicenses(scanOf([a]), map, null)).not.toThrow();
    expect(a.licenses[0].key).toBe('MIT');
  });

  it('does no database work and pulls in no Meteor (AC27)', () => {
    const fs = require('fs');
    const path = require('path');
    const raw = fs.readFileSync(path.join(__dirname,
      '../../imports/server/scan/componentLicensePick.js'), 'utf8');
    expect(raw).not.toMatch(/require\(\s*['"]meteor\//);
    expect(raw).not.toMatch(/from\s+['"]meteor\//);
    expect(raw).not.toMatch(/imports\/lib\/collections/);
    expect(raw).toMatch(/module\.exports\s*=/);
    expect(raw).not.toMatch(/^\s*export\s/m);
  });

  it('reuses componentPickLicense rather than building the entry inline', () => {
    const fs = require('fs');
    const path = require('path');
    const raw = fs.readFileSync(path.join(__dirname,
      '../../imports/server/scan/componentLicensePick.js'), 'utf8');
    expect(raw).toMatch(/require\(['"]\.\/rootDependency['"]\)/);
    expect(raw).not.toMatch(/origin:\s*COMPONENT_LICENSE_ORIGIN/);
  });
});
