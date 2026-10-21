/* eslint-disable no-undef */
// ---------------------------------------------------------------------------
// InjectResolvedLicenses against scans nobody would upload, and the
// cross-tenant leak guard asserted as a ROUND TRIP rather than a spot check.
//
// WHY THE ROUND TRIP MATTERS
//
// A confirmed live disclosure was recorded: a license this app injected
// into a scan was persisted, read back by the next `reprocessScan` as an
// ordinary scanner-declared license, and written by updateComponentFromDependency
// onto the `components` document - a GLOBAL catalogue every tenant reads. The key
// was one company's PRIVATE license key. `withoutRootPickLicenses` is the fix.
//
// The injection is generalised from ONE root node to arbitrarily many nodes, so
// the guard is now load-bearing across a whole tree rather than one entry.
// component-license-injection.unit.spec.js asserts the marker on a single node;
// this file walks a realistic tree, replays the component write path over EVERY
// node with the real exported helpers, and asserts BOTH directions:
//
//   * no injected entry reaches the shared catalogue (the leak guard), AND
//   * every scanner declaration DOES reach it (so the guard cannot pass by
//     dropping everything, and a future over-eager filter fails here).
//
// It also proves the guard is what does the work, by replaying the same walk
// WITHOUT the strip and showing the pick is present - a negative-only assertion
// that would still "pass" if the injection had silently stopped happening is
// exactly the vacuous test this file exists to avoid.
// ---------------------------------------------------------------------------
const {
  resolvedLicenseMap,
  injectResolvedLicenses
} = require('../../imports/server/scan/componentLicensePick');
const {
  COMPONENT_LICENSE_ORIGIN,
  ROOT_LICENSE_ORIGIN,
  componentPickLicense,
  rootPickLicense,
  isRootPickLicense,
  isInjectedLicense,
  withoutRootPickLicenses,
  withoutInjectedLicenses
} = require('../../imports/server/scan/rootDependency');
const {MAX_STORABLE_DEPENDENCY_DEPTH} =
  require('../../imports/server/scan/dependencyDepth');

function resolution(key, license) {
  return {key, license, comment: 'License set manually', justification: 'because'};
}

function moduleWith(entries) {
  return {componentConfig: {licensesSelected: entries}};
}

function mapFor(entries, names) {
  return resolvedLicenseMap(moduleWith(entries), names);
}

// Every node of a scan, in walk order, however deep or cyclic the tree is.
function allNodes(scan) {
  const out = [];
  const seen = new Set();
  (function walk(list) {
    if (!Array.isArray(list)) return;
    list.forEach((node) => {
      if (!node || typeof node !== 'object' || seen.has(node)) return;
      seen.add(node);
      out.push(node);
      walk(node.dependencies);
    });
  }(scan.dependencies));
  return out;
}

// What processScan's component write path would store for every node: it reads
// `dependency.licenses` through withoutRootPickLicenses (processScan.js:373 and
// :459) before updateComponentFromDependency touches the shared catalogue.
function componentsWriteFor(scan) {
  return allNodes(scan).map((node) => ({
    key: node.key,
    licenses: withoutRootPickLicenses(node.licenses) || []
  }));
}

// ---------------------------------------------------------------------------
// AC17 - the leak guard, over a whole tree, in both directions
// ---------------------------------------------------------------------------

describe('AC17 - a manual pick never reaches the shared components catalogue', () => {
  // A tree with the three shapes that actually occur: a root, a package the
  // scanner declared a license for, one it declared nothing for, and the same
  // resolved package appearing on two different paths.
  function tree() {
    const declared = {key: 'npm:express', licenses: [{key: 'MIT', name: 'MIT License'}]};
    const resolved1 = {key: 'npm:mystery', licenses: []};
    const resolved2 = {key: 'npm:mystery'};
    const alsoDeclared = {key: 'npm:lodash',
      licenses: [{name: 'Apache-2.0'}, {key: 'ISC'}]};
    return {
      _id: 's1',
      scan: {_id: 's1', dependencies: [{key: 'npm:app', licenses: [], dependencies: [
        declared, resolved1, {key: 'npm:mid', dependencies: [resolved2, alsoDeclared]}
      ]}]},
      declared, resolved1, resolved2, alsoDeclared
    };
  }

  it('strips every injected entry from what the components write would store', () => {
    const t = tree();
    injectResolvedLicenses(t.scan, mapFor([resolution('npm:mystery', 'ACME-PRIVATE-1')],
      {'ACME-PRIVATE-1': 'Acme House License'}), 'npm:app');

    const written = componentsWriteFor(t.scan);
    // NEGATIVE half: nothing carrying either marker, and - the actual disclosure
    // - the private key itself is nowhere in the payload.
    written.forEach((doc) => {
      doc.licenses.forEach((license) => {
        expect(isInjectedLicense(license)).toBe(false);
        expect(license.origin).not.toBe(COMPONENT_LICENSE_ORIGIN);
        expect(license.origin).not.toBe(ROOT_LICENSE_ORIGIN);
      });
    });
    expect(JSON.stringify(written)).not.toContain('ACME-PRIVATE-1');
    expect(JSON.stringify(written)).not.toContain('Acme House License');
  });

  it('still writes everything the SCANNER declared (the other direction)', () => {
    // Without this, a filter that dropped every license would pass the test
    // above while destroying the catalogue it was meant to protect.
    const t = tree();
    injectResolvedLicenses(t.scan, mapFor([resolution('npm:mystery', 'ACME-PRIVATE-1')]),
      'npm:app');
    const written = componentsWriteFor(t.scan);
    const byKey = {};
    written.forEach((doc) => { byKey[doc.key] = doc.licenses; });
    expect(byKey['npm:express']).toEqual([{key: 'MIT', name: 'MIT License'}]);
    expect(byKey['npm:lodash']).toEqual([{name: 'Apache-2.0'}, {key: 'ISC'}]);
    // The resolved component keeps NOTHING on the catalogue, because the scanner
    // declared nothing for it - which is the honest state.
    expect(byKey['npm:mystery']).toEqual([]);
  });

  it('the STRIP is what does it - the same walk without it leaks the key', () => {
    // Non-vacuity control. If injectResolvedLicenses silently stopped injecting,
    // the two assertions above would still pass; this one would not.
    const t = tree();
    injectResolvedLicenses(t.scan, mapFor([resolution('npm:mystery', 'ACME-PRIVATE-1')]),
      'npm:app');
    const unguarded = allNodes(t.scan).map((node) => node.licenses || []);
    expect(JSON.stringify(unguarded)).toContain('ACME-PRIVATE-1');
    expect(t.resolved1.licenses[0].origin).toBe(COMPONENT_LICENSE_ORIGIN);
    expect(t.resolved2.licenses[0].origin).toBe(COMPONENT_LICENSE_ORIGIN);
  });

  it('refuses a marked entry however many of them a stored scan carries', () => {
    // A scan re-processed several times before the marker filter existed could
    // carry a pile of them.
    const many = [];
    for (let i = 0; i < 50; i++) {
      many.push(componentPickLicense('PRIV-' + i));
      many.push(rootPickLicense('ROOT-' + i));
    }
    many.push({key: 'MIT'});
    expect(withoutRootPickLicenses(many)).toEqual([{key: 'MIT'}]);
  });

  it('holds for an entry whose ONLY property is the marker', () => {
    // isInjectedLicense reads `.origin` and nothing else, so an entry with no key
    // and no name is still ours and must still be dropped.
    expect(isRootPickLicense({origin: COMPONENT_LICENSE_ORIGIN})).toBe(true);
    expect(withoutRootPickLicenses([{origin: COMPONENT_LICENSE_ORIGIN}])).toEqual([]);
  });

  it('does NOT drop a license that merely mentions the marker in another field', () => {
    // The predicate must key on `origin`, not on a substring anywhere.
    const lookalikes = [
      {key: 'ts-component-pick'},
      {name: 'ts-component-pick'},
      {key: 'MIT', origin: 'ts-component-picked'},
      {key: 'MIT', origin: 'cyclonedx'},
      {key: 'MIT', origin: ['ts-component-pick']}
    ];
    expect(withoutRootPickLicenses(lookalikes)).toBe(lookalikes);
  });
});

describe('AC17 - the widened predicate cannot be quietly narrowed again', () => {
  // The whole of AC17 rests on ONE fact: the names the component write path calls
  // are the WIDENED predicate, not a root-only copy. A future edit that
  // reintroduces a narrow `isRootPickLicense` re-opens the disclosure silently -
  // every existing spec would keep passing, because the root case still works.
  it('the shipped names are the very same function objects as the wide ones', () => {
    expect(isRootPickLicense).toBe(isInjectedLicense);
    expect(withoutRootPickLicenses).toBe(withoutInjectedLicenses);
  });

  it('the SHIPPED names accept a component pick, not only a root pick', () => {
    // Asserted through the shipped names specifically. These are the identifiers
    // processScan.js calls; a narrowed copy fails here even if the wide pair
    // still exists beside it.
    expect(isRootPickLicense(componentPickLicense('PRIV-1'))).toBe(true);
    expect(isRootPickLicense(rootPickLicense('PRIV-1'))).toBe(true);
    expect(withoutRootPickLicenses([componentPickLicense('PRIV-1')])).toEqual([]);
    expect(withoutRootPickLicenses([rootPickLicense('PRIV-1')])).toEqual([]);
  });

  it('the two markers stay distinct stored values', () => {
    // Scans persisted before the generalisation carry ts-root-pick; collapsing the two into one
    // value would make each origin's own cleanup inexact.
    expect(ROOT_LICENSE_ORIGIN).toBe('ts-root-pick');
    expect(COMPONENT_LICENSE_ORIGIN).toBe('ts-component-pick');
    expect(ROOT_LICENSE_ORIGIN).not.toBe(COMPONENT_LICENSE_ORIGIN);
  });

  it('the entry the walk actually writes is the one the predicate recognises', () => {
    // Closes the loop between the producer and the guard: not "componentPickLicense
    // is recognised" but "what ends up in the scan is recognised".
    const node = {key: 'npm:a', licenses: []};
    injectResolvedLicenses({dependencies: [node]},
      mapFor([resolution('npm:a', 'PRIV-1')]), null);
    expect(node.licenses).toHaveLength(1);
    expect(isRootPickLicense(node.licenses[0])).toBe(true);
    expect(withoutRootPickLicenses(node.licenses)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC16 - repeated runs
// ---------------------------------------------------------------------------

describe('AC16 - injecting N times leaves exactly one marked entry', () => {
  it('converges after the first run and never accumulates', () => {
    // processScan persists the mutated scan, and PropagateLicensePicks re-runs
    // over that stored document on every save and every re-analysis. Ten saves
    // must not leave ten entries.
    const declaredA = {name: 'Apache-2.0'};
    const declaredB = {key: 'ISC'};
    const node = {key: 'npm:a', licenses: [declaredA, declaredB]};
    const scan = {dependencies: [node]};
    const map = mapFor([resolution('npm:a', 'MIT')], {MIT: 'MIT License'});

    for (let run = 1; run <= 10; run++) {
      const result = injectResolvedLicenses(scan, map, null);
      expect(result).toEqual({nodes: 1, keys: ['npm:a']});
      expect(node.licenses.filter(isInjectedLicense)).toHaveLength(1);
      expect(node.licenses).toHaveLength(3);
      // NON-DESTRUCTIVE: the scanner's own entries survive by identity and in
      // their original relative order, run after run.
      expect(node.licenses[1]).toBe(declaredA);
      expect(node.licenses[2]).toBe(declaredB);
      expect(node.licenses[0]).toEqual(
        {key: 'MIT', name: 'MIT License', origin: COMPONENT_LICENSE_ORIGIN});
    }
  });

  it('converges when the license picked changes between runs', () => {
    const declared = {name: 'Apache-2.0'};
    const node = {key: 'npm:a', licenses: [declared]};
    const scan = {dependencies: [node]};
    ['MIT', 'ISC', 'PRIV-1', 'MIT'].forEach((license) => {
      injectResolvedLicenses(scan, mapFor([resolution('npm:a', license)]), null);
      expect(node.licenses.filter(isInjectedLicense)).toHaveLength(1);
      expect(node.licenses[0].key).toBe(license);
      expect(node.licenses[1]).toBe(declared);
      expect(node.licenses).toHaveLength(2);
    });
  });

  it('leaves the node untouched once the resolution is withdrawn', () => {
    // Undo removes the entry from the module; the next run therefore carries an
    // empty map. The marker stays in the stored scan until an analysis re-runs -
    // clearComponentLicenseResolution sets analysisRequired for exactly that
    // reason - so this pins what the walk itself does, and does not do.
    const node = {key: 'npm:a', licenses: [{name: 'Apache-2.0'}]};
    const scan = {dependencies: [node]};
    injectResolvedLicenses(scan, mapFor([resolution('npm:a', 'MIT')]), null);
    expect(node.licenses).toHaveLength(2);
    expect(injectResolvedLicenses(scan, new Map(), null)).toEqual({nodes: 0, keys: []});
    expect(node.licenses).toHaveLength(2);
    // ...and the stale marker is still stripped from the components write.
    expect(withoutRootPickLicenses(node.licenses)).toEqual([{name: 'Apache-2.0'}]);
  });

  it('never mutates the licenses array it was handed, so a frozen one is safe', () => {
    // applyToNode filters into a NEW array and reassigns. That is what lets a
    // caller keep a reference to the scanner's original list.
    const original = Object.freeze([Object.freeze({name: 'Apache-2.0'})]);
    const node = {key: 'npm:a', licenses: original};
    expect(() => injectResolvedLicenses({dependencies: [node]},
      mapFor([resolution('npm:a', 'MIT')]), null)).not.toThrow();
    expect(original).toHaveLength(1);
    expect(node.licenses).not.toBe(original);
    expect(node.licenses[1]).toBe(original[0]);
  });
});

// ---------------------------------------------------------------------------
// Hostile trees
// ---------------------------------------------------------------------------

describe('hostile dependency trees', () => {
  it('applies the same key at every depth up to the bound, and not past it', () => {
    // The resolution is per (module, component key), so a package that appears at
    // depth 1 and again at depth 88 must be written at both.
    const targets = [];
    const depths = [1, 2, 3, 44, MAX_STORABLE_DEPENDENCY_DEPTH];
    let current = null;
    const chain = [];
    for (let depth = MAX_STORABLE_DEPENDENCY_DEPTH + 5; depth >= 1; depth--) {
      const node = depths.indexOf(depth) === -1 ?
        {key: 'npm:filler' + depth} : {key: 'npm:target', licenses: []};
      if (depths.indexOf(depth) !== -1) targets.push(node);
      if (current) node.dependencies = [current];
      current = node;
      chain.push(node);
    }
    // Nodes deeper than the bound: build one explicitly past it.
    const tooDeep = {key: 'npm:target', licenses: []};
    let deepChain = tooDeep;
    for (let i = 0; i < MAX_STORABLE_DEPENDENCY_DEPTH + 2; i++) {
      deepChain = {key: 'npm:pad' + i, dependencies: [deepChain]};
    }

    const scan = {dependencies: [current, deepChain]};
    injectResolvedLicenses(scan, mapFor([resolution('npm:target', 'MIT')]), null);
    targets.forEach((node) => expect(node.licenses[0].key).toBe('MIT'));
    expect(tooDeep.licenses).toEqual([]);
    expect(chain.length).toBeGreaterThan(MAX_STORABLE_DEPENDENCY_DEPTH);
  });

  it('visits a shared node object once, not once per parent', () => {
    // A dependency graph is a DAG in memory whenever a tree is built by
    // reference. Applying twice to the same object would double-count `nodes`
    // and, without the marker filter, double the entry.
    const shared = {key: 'npm:shared', licenses: [{name: 'ISC'}]};
    const scan = {dependencies: [
      {key: 'npm:a', dependencies: [shared]},
      {key: 'npm:b', dependencies: [shared]}
    ]};
    const result = injectResolvedLicenses(scan, mapFor([resolution('npm:shared', 'MIT')]),
      null);
    expect(result).toEqual({nodes: 1, keys: ['npm:shared']});
    expect(shared.licenses).toEqual([
      {key: 'MIT', name: 'MIT', origin: COMPONENT_LICENSE_ORIGIN}, {name: 'ISC'}]);
  });

  it('reaches a resolved node that sits behind a cycle', () => {
    // The `seen` set must terminate the walk without cutting off a branch that
    // has not been visited yet.
    const a = {key: 'npm:a'};
    const b = {key: 'npm:b'};
    const target = {key: 'npm:target', licenses: []};
    a.dependencies = [b];
    b.dependencies = [a, target];
    const result = injectResolvedLicenses({dependencies: [a]},
      mapFor([resolution('npm:target', 'MIT')]), null);
    expect(result).toEqual({nodes: 1, keys: ['npm:target']});
    expect(target.licenses[0].key).toBe('MIT');
  });

  it('terminates on a node that lists itself', () => {
    const self = {key: 'npm:self', licenses: []};
    self.dependencies = [self];
    expect(() => injectResolvedLicenses({dependencies: [self]},
      mapFor([resolution('npm:self', 'MIT')]), null)).not.toThrow();
    expect(self.licenses).toHaveLength(1);
  });

  it('terminates on a wide cycle and still writes what is inside the bound', () => {
    // A ring of nodes, each depending on the next and the last back on the first.
    // The walk has to close the ring rather than spin, and still reach a target
    // that sits inside MAX_STORABLE_DEPENDENCY_DEPTH.
    const ring = [];
    const size = MAX_STORABLE_DEPENDENCY_DEPTH - 20;
    for (let i = 0; i < size; i++) ring.push({key: 'npm:n' + i, licenses: []});
    ring.forEach((node, i) => { node.dependencies = [ring[(i + 1) % size]]; });
    const target = Math.floor(size / 2);
    const result = injectResolvedLicenses({dependencies: [ring[0]]},
      mapFor([resolution('npm:n' + target, 'MIT')]), null);
    expect(result).toEqual({nodes: 1, keys: ['npm:n' + target]});
    expect(ring[target].licenses[0].key).toBe('MIT');
  });

  it('does not reach a node the ring only exposes past the depth bound', () => {
    // The complement of the case above, so "it terminated" can never be mistaken
    // for "it wrote everything". A ring longer than the bound leaves its far side
    // unwritten - which is the documented, deliberate consequence of bounding the
    // walk with the same depth the ingest path publishes.
    const size = MAX_STORABLE_DEPENDENCY_DEPTH + 40;
    const ring = [];
    for (let i = 0; i < size; i++) ring.push({key: 'npm:r' + i, licenses: []});
    ring.forEach((node, i) => { node.dependencies = [ring[(i + 1) % size]]; });
    const beyond = size - 5;
    const result = injectResolvedLicenses({dependencies: [ring[0]]},
      mapFor([resolution('npm:r' + beyond, 'MIT')]), null);
    expect(result).toEqual({nodes: 0, keys: []});
    expect(ring[beyond].licenses).toEqual([]);
  });

  it('ignores a node whose key is not a usable string', () => {
    const nodes = [{key: 7, licenses: []}, {key: null, licenses: []},
      {key: '', licenses: []}, {key: {}, licenses: []}, {key: ['npm:a'], licenses: []},
      {licenses: []}];
    injectResolvedLicenses({dependencies: nodes},
      mapFor([resolution('npm:a', 'MIT')]), null);
    nodes.forEach((node) => expect(node.licenses).toEqual([]));
  });

  it('keeps the junk a stored scan carries in a licenses array', () => {
    // Non-destructive means non-destructive: entries the predicate cannot judge
    // are not ours to remove.
    const junk = [null, 'MIT', 7, [], {}];
    const node = {key: 'npm:a', licenses: junk.slice()};
    expect(() => injectResolvedLicenses({dependencies: [node]},
      mapFor([resolution('npm:a', 'MIT')]), null)).not.toThrow();
    expect(node.licenses.slice(1)).toEqual(junk);
    expect(node.licenses[0].origin).toBe(COMPONENT_LICENSE_ORIGIN);
  });

  it('matches the root key exactly, never by prefix or by case', () => {
    // The skip exists so applyRootLicense owns exactly ONE node. A loose match
    // would silently stop resolving a package whose key merely starts the same.
    const lookalikes = ['npm:application', 'npm:ap', 'NPM:APP', ' npm:app', 'npm:app '];
    const nodes = lookalikes.map((key) => ({key, licenses: []}));
    const root = {key: 'npm:app', licenses: [], dependencies: nodes};
    injectResolvedLicenses({dependencies: [root]},
      mapFor(lookalikes.concat(['npm:app']).map((k) => resolution(k, 'MIT'))), 'npm:app');
    expect(root.licenses).toEqual([]);
    nodes.forEach((node) => expect(node.licenses[0].key).toBe('MIT'));
  });

  it('skips nothing when the caller has no root key to protect', () => {
    [null, undefined, '', 0, false].forEach((rootKey) => {
      const node = {key: 'npm:app', licenses: []};
      const result = injectResolvedLicenses({dependencies: [node]},
        mapFor([resolution('npm:app', 'MIT')]), rootKey);
      expect(result.nodes).toBe(1);
      expect(node.licenses[0].key).toBe('MIT');
    });
  });

  it('reports counts that match what it actually wrote', () => {
    // `nodes` drives the log line an operator reads; a number that does not match
    // the tree is worse than none.
    const nodes = [];
    const scan = {dependencies: []};
    for (let i = 0; i < 30; i++) {
      const node = {key: 'npm:p' + (i % 3), licenses: []};
      nodes.push(node);
      scan.dependencies.push(node);
    }
    const result = injectResolvedLicenses(scan,
      mapFor([resolution('npm:p0', 'MIT'), resolution('npm:p2', 'ISC')]), null);
    const written = nodes.filter((node) => node.licenses.length > 0);
    expect(result.nodes).toBe(written.length);
    expect(result.keys).toEqual(['npm:p0', 'npm:p2']);
  });

  it('survives a tree parsed from a crafted JSON payload', () => {
    const scan = JSON.parse('{"dependencies": [{"key": "npm:a", "licenses": [], ' +
      '"__proto__": {"polluted139": true}, "dependencies": [' +
      '{"key": "__proto__", "licenses": []}]}]}');
    injectResolvedLicenses(scan, mapFor([resolution('npm:a', 'MIT'),
      resolution('__proto__', 'ISC')]), null);
    expect(scan.dependencies[0].licenses[0].key).toBe('MIT');
    expect(scan.dependencies[0].dependencies[0].licenses[0].key).toBe('ISC');
    expect({}.polluted139).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// The root-skip rule against applyRootLicense's own storage slot
// ---------------------------------------------------------------------------

describe('a component that is BOTH the root and manually resolved', () => {
  it('is left entirely to applyRootLicense, licenses untouched', () => {
    const root = {key: 'npm:app', licenses: [{name: 'Apache-2.0'}], dependencies: [
      {key: 'npm:left-pad', licenses: []}]};
    const result = injectResolvedLicenses({dependencies: [root]}, mapFor([
      resolution('npm:app', 'ROOT-PRIV'), resolution('npm:left-pad', 'MIT')]), 'npm:app');
    expect(root.licenses).toEqual([{name: 'Apache-2.0'}]);
    expect(result).toEqual({nodes: 1, keys: ['npm:left-pad']});
  });

  it('is skipped at EVERY depth it appears, not only at the top', () => {
    // A monorepo scan can list the root package as its own transitive
    // dependency. Skipping it only at the top would let both writers fight over
    // one node lower down.
    const deep = {key: 'npm:app', licenses: []};
    const top = {key: 'npm:app', licenses: [], dependencies: [
      {key: 'npm:mid', dependencies: [deep]}]};
    const result = injectResolvedLicenses({dependencies: [top]},
      mapFor([resolution('npm:app', 'ROOT-PRIV')]), 'npm:app');
    expect(top.licenses).toEqual([]);
    expect(deep.licenses).toEqual([]);
    expect(result).toEqual({nodes: 0, keys: []});
  });

  it('leaves a stale marker on the root for the root path to clean up', () => {
    // stripInjectedRootLicenses (rootDependency.js) owns that cleanup and runs
    // BEFORE the dependency loop; this walk must not do half of its job.
    const root = {key: 'npm:app', licenses: [componentPickLicense('PRIV-1')]};
    injectResolvedLicenses({dependencies: [root]},
      mapFor([resolution('npm:app', 'PRIV-2')]), 'npm:app');
    expect(root.licenses).toEqual([componentPickLicense('PRIV-1')]);
    // ...and the components write still refuses it, so nothing leaks meanwhile.
    expect(withoutRootPickLicenses(root.licenses)).toEqual([]);
  });
});
