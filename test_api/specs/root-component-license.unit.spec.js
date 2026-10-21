// Root-component license - which scan entry the picked license is
// written onto, and why it must never travel any further than that entry.
//
// Two defects meet in this file.
//
// 1) WHICH ENTRY. The picker is offered whenever the analysis reports a single
//    root component (`analysis.rootComponentsCount === 1`), which says nothing
//    about whether that component has dependencies of its own. `findRootDependency`
//    however only considered entries that HAD children, so for a scan of an
//    application with no dependencies it returned null: the pick was saved to
//    `componentConfig.licensesSelected`, the toast said "Re-analysing...", the
//    analysis ran - and the license was silently never injected into the scan, so
//    the component came back "unknown". Reproduced 2026-08-25 on module
//    test-cydx-rt-1786455096800 (one top-level entry, zero children).
//
// 2) WHERE IT LEAKS TO. applyRootLicense writes the resolved license into
//    `root.licenses` and processScan persists the whole mutated scan. That entry is
//    read back as an ordinary declared license by the handleDependency loop on the
//    NEXT run over the same scan - `reprocessScan` is a live method behind the
//    "Re-process" button - and updateComponentFromDependency writes it onto the
//    `components` document. `components` is a GLOBAL catalogue shared by every
//    tenant and the injected key is normally a company-PRIVATE license key
//    (matchLicense resolves a private key by exact match), so every re-process
//    disclosed one company's private key on a document all other companies read.
//    Confirmed in the local database: component pp4MgfRT5p9TDmSEJ had accumulated
//    [{key:"ROOT_SAMPLE"},{key:"ROOT_WITH_DESCRIPTION"}].
//
//    The invariant that used to be asserted here - "applyRootLicense runs AFTER the
//    handleDependency loop" - only holds WITHIN one run and is defeated by exactly
//    that re-process, so it is replaced below by the invariant the code now
//    implements: the injected entry is marked, and the component write path skips
//    marked entries.
const fs = require('fs');
const path = require('path');

const {
  findRootDependency,
  ROOT_LICENSE_ORIGIN,
  COMPONENT_LICENSE_ORIGIN,
  rootPickLicense,
  componentPickLicense,
  isRootPickLicense,
  isInjectedLicense,
  withoutRootPickLicenses,
  withoutInjectedLicenses,
  injectableRootLicenseKeys,
  stripInjectedRootLicenses
} = require('../../imports/server/scan/rootDependency');

const REPO = path.join(__dirname, '..', '..');
const PROCESS_SCAN = path.join(REPO, 'imports', 'server', 'scan', 'processScan.js');

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

// Comment-aware read. processScan.js and rootDependency.js both carry long comments
// that name every identifier under assertion, so a plain substring match against the
// raw file passes on prose alone - a recent audit caught exactly that false positive.
function readCode(file) {
  return read(file)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function dep(key, children) {
  const d = {key: key};
  if (children) d.dependencies = children;
  return d;
}

describe('findRootDependency', () => {
  it('treats a lone top-level entry as the root even with no children', () => {
    // The regression: an application that declares no dependencies.
    const scan = {_id: 's1', moduleIdentifier: 'test-cydx-rt-1786455096800',
      dependencies: [dep('npm:rt-app')]};
    const root = findRootDependency(scan);
    expect(root).not.toBeNull();
    expect(root.key).toBe('npm:rt-app');
  });

  it('does not require the lone entry key to match the module identifier', () => {
    // Real data: the module is named test-cydx-rt-…, its root component npm:rt-app.
    const scan = {_id: 's2', moduleIdentifier: 'a-module-name',
      dependencies: [dep('npm:something-else')]};
    expect(findRootDependency(scan).key).toBe('npm:something-else');
  });

  it('still returns the lone entry that has children', () => {
    const scan = {_id: 's3', dependencies: [dep('npm:app', [dep('npm:left-pad')])]};
    expect(findRootDependency(scan).key).toBe('npm:app');
  });

  it('picks the entry with children when several are top level', () => {
    const scan = {_id: 's4', dependencies: [dep('npm:a'), dep('npm:app', [dep('npm:b')])]};
    expect(findRootDependency(scan).key).toBe('npm:app');
  });

  it('disambiguates several parents by the module identifier', () => {
    const scan = {_id: 's5', moduleIdentifier: 'npm:app',
      dependencies: [dep('npm:other', [dep('npm:x')]), dep('npm:app', [dep('npm:y')])]};
    expect(findRootDependency(scan).key).toBe('npm:app');
  });

  it('falls back to `module` when moduleIdentifier is absent', () => {
    const scan = {_id: 's6', module: 'npm:app',
      dependencies: [dep('npm:other', [dep('npm:x')]), dep('npm:app', [dep('npm:y')])]};
    expect(findRootDependency(scan).key).toBe('npm:app');
  });

  it('refuses to guess a root from a flat list of several childless entries', () => {
    // Overwriting an ordinary component's licenses is worse than doing nothing.
    const scan = {_id: 's7', dependencies: [dep('npm:a'), dep('npm:b'), dep('npm:c')]};
    expect(findRootDependency(scan)).toBeNull();
  });

  it('returns null for an empty or missing dependency tree', () => {
    expect(findRootDependency({_id: 's8', dependencies: []})).toBeNull();
    expect(findRootDependency({_id: 's9'})).toBeNull();
    expect(findRootDependency(null)).toBeNull();
    expect(findRootDependency(undefined)).toBeNull();
  });
});

describe('the injected root license is marked as ours', () => {
  it('stamps the origin marker on the entry applyRootLicense injects', () => {
    expect(rootPickLicense('ROOT_SAMPLE', 'Root Sample'))
      .toEqual({key: 'ROOT_SAMPLE', name: 'Root Sample', origin: ROOT_LICENSE_ORIGIN});
  });

  it('falls back to the key when the license has no resolvable name', () => {
    // A company-private key is not in the Licenses collection, so applyRootLicense
    // has nothing but the key itself to display.
    expect(rootPickLicense('ROOT_SAMPLE').name).toBe('ROOT_SAMPLE');
  });

  it('recognises only its own marker', () => {
    expect(isRootPickLicense(rootPickLicense('MIT'))).toBe(true);
    // A license the scanner declared - the shape that MUST still reach components.
    expect(isRootPickLicense({key: 'MIT', name: 'MIT License'})).toBe(false);
    expect(isRootPickLicense({name: 'MIT', origin: 'cyclonedx'})).toBe(false);
    expect(isRootPickLicense(null)).toBe(false);
    expect(isRootPickLicense(undefined)).toBe(false);
  });
});

describe('the component write path skips what we injected', () => {
  it('closes the loop: what applyRootLicense injects never reaches a component', () => {
    // The full round trip, in the shape the bug had: run one injects, run two
    // reads the persisted scan back.
    const root = {key: 'npm:rt-app', licenses: [rootPickLicense('ROOT_SAMPLE')]};
    expect(withoutRootPickLicenses(root.licenses)).toEqual([]);
  });

  it('keeps the scanner-declared licenses that sit beside it', () => {
    const declared = {name: 'MIT'};
    const licenses = [declared, rootPickLicense('ROOT_SAMPLE')];
    expect(withoutRootPickLicenses(licenses)).toEqual([declared]);
  });

  it('hands back the very same array when there is nothing to strip', () => {
    // Identity matters: createComponentFromDependency mutates the list it is given
    // (it pushes the extra keys matchWellknownLicenseName resolves), so the ordinary
    // dependency must keep the exact mutate-in-place semantics it had before.
    const licenses = [{name: 'MIT'}, {name: 'Apache-2.0'}];
    expect(withoutRootPickLicenses(licenses)).toBe(licenses);
  });

  it('leaves the injected entry itself untouched in the scan', () => {
    // Non-negotiable: ts-analysis 3.7.6 reads the root license out of the scan
    // payload, so stripping is for the component write path only - never a mutation
    // of what gets persisted.
    const licenses = [rootPickLicense('ROOT_SAMPLE')];
    withoutRootPickLicenses(licenses);
    expect(licenses).toHaveLength(1);
    expect(licenses[0].key).toBe('ROOT_SAMPLE');
  });

  it('passes non-arrays through so callers keep their own guards', () => {
    expect(withoutRootPickLicenses(undefined)).toBeUndefined();
    expect(withoutRootPickLicenses(null)).toBeNull();
  });
});

// The predicate was widened to a SECOND injection origin: a license a
// compliance manager set manually on an arbitrary dependency
// (imports/server/scan/componentLicensePick.js). The names below are unchanged
// on purpose - `withoutRootPickLicenses` is called for every dependency at
// processScan.js:373 and :459 and `mapLicenseFromScanLicense` refuses marked
// entries at :529, so widening the predicate is what keeps the new origin off
// the shared `components` catalogue with NO change to the component write path.
describe('the marker predicate covers both injection origins (issue #139, AC17)', () => {
  it('stamps a distinct origin on a component pick', () => {
    expect(componentPickLicense('PRIV-1', 'House License'))
      .toEqual({key: 'PRIV-1', name: 'House License', origin: COMPONENT_LICENSE_ORIGIN});
    expect(componentPickLicense('PRIV-1').name).toBe('PRIV-1');
    expect(COMPONENT_LICENSE_ORIGIN).toBe('ts-component-pick');
    expect(COMPONENT_LICENSE_ORIGIN).not.toBe(ROOT_LICENSE_ORIGIN);
  });

  it('recognises both origins as ours, and nothing else', () => {
    expect(isInjectedLicense(rootPickLicense('MIT'))).toBe(true);
    expect(isInjectedLicense(componentPickLicense('MIT'))).toBe(true);
    expect(isInjectedLicense({key: 'MIT', name: 'MIT License'})).toBe(false);
    expect(isInjectedLicense({name: 'MIT', origin: 'cyclonedx'})).toBe(false);
    expect(isInjectedLicense(null)).toBe(false);
    expect(isInjectedLicense(undefined)).toBe(false);
  });

  it('keeps the shipped names as the SAME predicate, not a second copy', () => {
    // The two component write paths and mapLicenseFromScanLicense all call the
    // old names. If they were a separate narrower predicate, a component pick
    // would leak onto the shared catalogue on the next re-process.
    expect(isRootPickLicense).toBe(isInjectedLicense);
    expect(withoutRootPickLicenses).toBe(withoutInjectedLicenses);
  });

  it('THE leak guard: a component pick never survives to a components write', () => {
    expect(withoutRootPickLicenses([componentPickLicense('PRIV-1')])).toEqual([]);
    expect(withoutRootPickLicenses(
      [{name: 'MIT'}, componentPickLicense('PRIV-1'), rootPickLicense('PRIV-2')]))
      .toEqual([{name: 'MIT'}]);
  });

  it('mapLicenseFromScanLicense yields neither key nor name for a component pick', () => {
    // processScan.js pulls in meteor/* and cannot be required here, so the
    // assertion is in two halves that compose. Half one, executable: the
    // predicate that guards the function is true for a component pick.
    expect(isRootPickLicense(componentPickLicense('PRIV-1'))).toBe(true);
    // Half two, source: the guarded early return sets ONLY `message`, so the
    // caller has neither `mappedLicense.key` nor `.name` to store.
    const src = readCode(PROCESS_SCAN);
    const at = src.indexOf('function mapLicenseFromScanLicense');
    const body = src.slice(at, src.indexOf('\n}', at));
    const guard = body.slice(body.indexOf('if (isRootPickLicense(license))'));
    const early = guard.slice(0, guard.indexOf('return l;'));
    expect(early).toMatch(/l\.message = /);
    expect(early).not.toMatch(/l\.key = /);
    expect(early).not.toMatch(/l\.name = /);
  });

  it('a stale component pick on the root is stripped on re-process too', () => {
    const root = {key: 'npm:rt-app', licenses: [componentPickLicense('PRIV-1')]};
    expect(stripInjectedRootLicenses(root, {privateLicenses: []}, {_id: 'm1'})).toBe(true);
    expect(root.licenses).toEqual([]);
  });
});

describe('injectableRootLicenseKeys - what applyRootLicense could have written', () => {
  // The load-bearing half of the narrowed rule, asserted on its own so a change to
  // applyRootLicense's own resolution has an obvious counterpart to update.
  const root = {key: 'npm:rt-app'};

  it('collects the module pick for this root and the company default', () => {
    const module = {componentConfig: {licensesSelected: [
      {key: 'npm:rt-app', license: 'ROOT_SAMPLE'},
      {key: 'npm:left-pad', license: 'ROOT_OTHER'}
    ]}};
    const company = {defaultRootComponentLicense: 'ROOT_DEFAULT'};
    expect([...injectableRootLicenseKeys(root, company, module)].sort())
      .toEqual(['ROOT_DEFAULT', 'ROOT_SAMPLE']);
  });

  it('is empty when neither source names anything', () => {
    expect([...injectableRootLicenseKeys(root, {}, {})]).toEqual([]);
    expect([...injectableRootLicenseKeys(root, null, null)]).toEqual([]);
    expect([...injectableRootLicenseKeys(null, undefined, undefined)]).toEqual([]);
  });

  it('needs a root key before any module pick counts', () => {
    // applyRootLicense returns on `!root.key`, so it never injected for such a root.
    const module = {componentConfig: {licensesSelected: [{key: undefined, license: 'X'}]}};
    expect([...injectableRootLicenseKeys({}, {}, module)]).toEqual([]);
  });
});

describe('scans injected before the marker existed are cleaned on re-process', () => {
  // A company may key a private license anything at all: privateLicenses.create
  // (imports/server/collections/companies.js) does not check the key against the
  // SPDX catalogue, so `MIT` and `Apache-2.0` are perfectly legal private keys.
  // "key is private" therefore CANNOT on its own mean "we injected it" - see the
  // collision block below.
  const company = {
    privateLicenses: [{key: 'ROOT_SAMPLE', name: 'Root Sample'}, {key: 'ROOT_WITH_DESCRIPTION'}]
  };

  function modulePick(rootKey, license) {
    return {_id: 'm1', componentConfig: {licensesSelected: [{key: rootKey, license: license}]}};
  }

  it('drops an unmarked entry matching the module\'s own saved pick for this root', () => {
    // Exactly one of the two keys found accumulated on the shared component
    // document: the module's licensesSelected still names it for this root key, so
    // this entry is a pre-marker injection of that very pick.
    const root = {key: 'npm:rt-app', licenses: [{key: 'ROOT_SAMPLE', name: 'ROOT_SAMPLE'}]};
    expect(stripInjectedRootLicenses(root, company, modulePick('npm:rt-app', 'ROOT_SAMPLE'))).toBe(true);
    expect(root.licenses).toEqual([]);
  });

  it('drops an unmarked entry matching the company default root license', () => {
    // The other value applyRootLicense can resolve: source === 'default'.
    const root = {key: 'npm:rt-app',
      licenses: [{key: 'ROOT_WITH_DESCRIPTION', name: 'ROOT_WITH_DESCRIPTION'}]};
    const withDefault = Object.assign({defaultRootComponentLicense: 'ROOT_WITH_DESCRIPTION'}, company);
    expect(stripInjectedRootLicenses(root, withDefault, {_id: 'm1'})).toBe(true);
    expect(root.licenses).toEqual([]);
  });

  it('drops a marked entry regardless of company or module', () => {
    // The exact path: it must never regress to "only when some key matches".
    const root = {key: 'npm:rt-app', licenses: [rootPickLicense('MIT')]};
    expect(stripInjectedRootLicenses(root, {privateLicenses: []}, {_id: 'm1'})).toBe(true);
    expect(root.licenses).toEqual([]);
    const bare = {key: 'npm:rt-app', licenses: [rootPickLicense('ROOT_SAMPLE')]};
    expect(stripInjectedRootLicenses(bare, undefined, undefined)).toBe(true);
    expect(bare.licenses).toEqual([]);
  });

  it('keeps every license the scanner really declared', () => {
    const root = {key: 'npm:rt-app',
      licenses: [{name: 'MIT'}, {key: 'Apache-2.0', name: 'Apache License 2.0'}]};
    expect(stripInjectedRootLicenses(root, company, modulePick('npm:rt-app', 'ROOT_SAMPLE'))).toBe(false);
    expect(root.licenses).toHaveLength(2);
  });

  it('does not treat an inherited object member name as a private key', () => {
    const root = {key: 'npm:rt-app', licenses: [{key: 'constructor', name: 'constructor'}]};
    const withDefault = Object.assign({defaultRootComponentLicense: 'constructor'}, company);
    expect(stripInjectedRootLicenses(root, withDefault, modulePick('npm:rt-app', 'constructor'))).toBe(false);
    expect(root.licenses).toHaveLength(1);
  });

  it('reports no change - and touches nothing - for an untouched scan', () => {
    const mod = modulePick('npm:a', 'ROOT_SAMPLE');
    expect(stripInjectedRootLicenses({key: 'npm:a'}, company, mod)).toBe(false);
    expect(stripInjectedRootLicenses({key: 'npm:a', licenses: []}, company, mod)).toBe(false);
    expect(stripInjectedRootLicenses(null, company, mod)).toBe(false);
    expect(stripInjectedRootLicenses({key: 'npm:a', licenses: [{name: 'MIT'}]}, null, null)).toBe(false);
  });

  it('survives malformed company and module documents', () => {
    const root = {key: 'npm:rt-app', licenses: [{key: 'ROOT_SAMPLE'}]};
    expect(stripInjectedRootLicenses(root, {privateLicenses: 'nope'},
      {componentConfig: {licensesSelected: 'nope'}})).toBe(false);
    expect(root.licenses).toHaveLength(1);
    expect(stripInjectedRootLicenses(root, {privateLicenses: [null, {}, {key: 7}]},
      {componentConfig: {licensesSelected: [null, {}, {key: 'npm:rt-app'}]}})).toBe(false);
  });
});

describe('a scanner declaration is never destroyed by a private-key collision', () => {
  // The Major QA finding. The strip runs BEFORE the handleDependency loop and
  // processScan persists the mutated scan wholesale, while applyRootLicense has
  // three early-return paths (!root, !root.key, !resolvedLicense) that put nothing
  // back. A wrongly stripped declaration is therefore gone from the stored scan,
  // from that run's component write and from what ts-analysis reads - recoverable
  // only by re-uploading the original scan. So the rule for UNMARKED entries has to
  // be narrow: strip only what applyRootLicense could actually have injected, i.e.
  // the module's current pick for this root key, or the company default.
  const collidingCompany = {
    privateLicenses: [{key: 'MIT', name: 'House MIT'}, {key: 'Apache-2.0', name: 'House Apache'}]
  };

  it('preserves a scanner-declared MIT when the company also has a private MIT', () => {
    const root = {key: 'npm:rt-app', licenses: [{key: 'MIT', name: 'MIT License'}]};
    expect(stripInjectedRootLicenses(root, collidingCompany, {_id: 'm1'})).toBe(false);
    expect(root.licenses).toEqual([{key: 'MIT', name: 'MIT License'}]);
  });

  it('preserves both when the root is an ordinary package from a single-component import', () => {
    // findRootDependency now accepts a lone childless top-level entry, so the
    // "root" can be a third-party package whose real licenses must survive.
    const root = {key: 'npm:left-pad',
      licenses: [{key: 'MIT', name: 'MIT License'}, {key: 'Apache-2.0', name: 'Apache License 2.0'}]};
    expect(stripInjectedRootLicenses(root, collidingCompany, {_id: 'm1'})).toBe(false);
    expect(root.licenses).toHaveLength(2);
  });

  it('strips only the colliding key the module actually picked, keeping the rest', () => {
    const root = {key: 'npm:rt-app',
      licenses: [{key: 'MIT', name: 'MIT License'}, {key: 'Apache-2.0', name: 'Apache License 2.0'}]};
    const module = {_id: 'm1',
      componentConfig: {licensesSelected: [{key: 'npm:rt-app', license: 'MIT'}]}};
    expect(stripInjectedRootLicenses(root, collidingCompany, module)).toBe(true);
    expect(root.licenses).toEqual([{key: 'Apache-2.0', name: 'Apache License 2.0'}]);
  });

  it('ignores a pick saved for a DIFFERENT root key', () => {
    // licensesSelected holds one entry per component key; only the entry for THIS
    // root is a value applyRootLicense could have injected here.
    const root = {key: 'npm:rt-app', licenses: [{key: 'MIT', name: 'MIT License'}]};
    const module = {_id: 'm1',
      componentConfig: {licensesSelected: [{key: 'npm:other', license: 'MIT'}]}};
    expect(stripInjectedRootLicenses(root, collidingCompany, module)).toBe(false);
    expect(root.licenses).toHaveLength(1);
  });

  it('ignores a licensesSelected entry that carries no license', () => {
    // applyRootLicense requires `e.license` before it will inject, so an entry
    // without one never produced an injection.
    const root = {key: 'npm:rt-app', licenses: [{key: 'MIT', name: 'MIT License'}]};
    const module = {_id: 'm1', componentConfig: {licensesSelected: [{key: 'npm:rt-app'}]}};
    expect(stripInjectedRootLicenses(root, collidingCompany, module)).toBe(false);
    expect(root.licenses).toHaveLength(1);
  });

  it('keeps a pre-marker injection of a PUBLIC key rather than risk a declaration', () => {
    // A pick that is not a private license leaks nothing onto the shared catalogue,
    // so the ambiguity is resolved in favour of the scanner. applyRootLicense
    // re-injects the current pick as a MARKED entry right after the loop anyway.
    const root = {key: 'npm:rt-app', licenses: [{key: 'BSD-3-Clause', name: 'BSD 3-Clause'}]};
    const module = {_id: 'm1',
      componentConfig: {licensesSelected: [{key: 'npm:rt-app', license: 'BSD-3-Clause'}]}};
    expect(stripInjectedRootLicenses(root, collidingCompany, module)).toBe(false);
    expect(root.licenses).toHaveLength(1);
  });
});

describe('source lock - processScan wires both ends of the loop', () => {
  it('uses the shared resolver instead of defining its own', () => {
    const src = readCode(PROCESS_SCAN);
    // positive anchor - live code, not the comment that also names both symbols
    expect(src).toMatch(/from '\/imports\/server\/scan\/rootDependency'/);
    expect(src).toMatch(/export \{findRootDependency\}/);
    // non-vacuity: the old children-only filter must no longer live here
    expect(src).not.toMatch(/const candidates = \(scan && scan\.dependencies \|\| \[\]\)\.filter/);
  });

  it('applyRootLicense still bails out when there is no resolvable root', () => {
    const src = readCode(PROCESS_SCAN);
    expect(src).toMatch(/const root = findRootDependency\(scan\);\s*\n\s*if \(!root \|\| !root\.key\) return;/);
  });

  it('applyRootLicense injects a MARKED entry', () => {
    const src = readCode(PROCESS_SCAN);
    expect(src).toMatch(/root\.licenses = \[rootPickLicense\(/);
    // non-vacuity: the bare object literal it replaced must be gone, otherwise the
    // entry goes back to being indistinguishable from a declared license.
    expect(src).not.toMatch(/root\.licenses = \[\{\s*\n?\s*key: resolvedLicense/);
  });

  it('both component write paths read licenses through the strip helper', () => {
    const src = readCode(PROCESS_SCAN);
    const matches = src.match(/withoutRootPickLicenses\(dependency\.licenses\)/g) || [];
    // createComponentFromDependency and updateComponentFromDependency.
    expect(matches.length).toBe(2);
    // non-vacuity: neither may still iterate the raw list.
    expect(src).not.toMatch(/const tempList = dependency\.licenses/);
    expect(src).not.toMatch(/dependency\.licenses\.forEach/);
  });

  it('mapLicenseFromScanLicense refuses a marked entry as well', () => {
    // Defence in depth: any future write path funnels through here too.
    const src = readCode(PROCESS_SCAN);
    const at = src.indexOf('function mapLicenseFromScanLicense');
    expect(at).toBeGreaterThan(-1);
    const body = src.slice(at, src.indexOf('\n}', at));
    expect(body).toMatch(/if \(isRootPickLicense\(license\)\)/);
    // and it must bail out before it can map anything
    const guardAt = body.indexOf('isRootPickLicense(license)');
    const matchAt = body.indexOf('matchLicense(');
    expect(matchAt).toBeGreaterThan(guardAt);
  });

  it('strips an already-persisted injection BEFORE the dependency loop runs', () => {
    // Ordering invariant that actually holds across runs: the previous run's entry
    // has to be gone before handleDependency walks the tree, or the first
    // re-process of a pre-marker scan leaks once more.
    const src = readCode(PROCESS_SCAN);
    const stripAt = src.indexOf('stripInjectedRootLicenses(');
    const loopAt = src.indexOf('for (const dependency of scan.dependencies || [])');
    const applyAt = src.indexOf('await applyRootLicense(scan, module, company, user)');
    expect(stripAt).toBeGreaterThan(-1);
    expect(loopAt).toBeGreaterThan(stripAt);
    expect(applyAt).toBeGreaterThan(loopAt);
  });

  it('hands the strip the company AND the module it needs to tell ours apart', () => {
    // Without the module the helper cannot see componentConfig.licensesSelected and
    // falls back to the over-broad "any private key" rule that destroyed
    // scanner-declared licenses.
    const src = readCode(PROCESS_SCAN);
    expect(src).toMatch(/stripInjectedRootLicenses\(storedRoot, company, module\)/);
    expect(src).not.toMatch(/stripInjectedRootLicenses\(storedRoot, company && company\.privateLicenses\)/);
  });

  it('resolves the company private licenses once, guarded, for the whole run', () => {
    // The strip mutates the in-memory scan before the loop; an unguarded
    // `company.privateLicenses` right after it would throw on a missing company
    // document with the scan already modified.
    //
    // The walk takes a per-run context object (handleDependency had to
    // grow a skip collector that must not be shared between concurrent runs), so the
    // resolved list travels on `ctx.privateLicenses` rather than as the fourth positional
    // argument. The invariant is unchanged: resolved once, guarded, and it is the resolved
    // value the walk gets.
    const src = readCode(PROCESS_SCAN);
    expect(src).toMatch(/const companyPrivateLicenses = \(company && company\.privateLicenses\) \|\| \[\];/);
    expect(src).toMatch(/privateLicenses: companyPrivateLicenses/);
    expect(src).toMatch(/handleDependency\(dependency, '\/', ctx\)/);
    expect(src).not.toMatch(/privateLicenses: company\.privateLicenses/);
  });

  it('still persists the injected license into the scan', () => {
    // ts-analysis 3.7.6 reads the root's licenses out of the scan payload
    // (gatherComponents -> declaredScanLicenses), so removing the write would break
    // the analyzer even though it would also "fix" the leak.
    //
    // The write is a targeted $set instead of a whole-document
    // replace (the replace clobbered any concurrent write to the scan). `dependencies` is
    // where the root's licenses live, so it is what has to stay in the modifier.
    const src = readCode(PROCESS_SCAN);
    expect(src).toMatch(/\$set\.dependencies = scan\.dependencies;/);
    expect(src).toMatch(/await Scans\.updateAsync\(\{_id: scan\._id, companyId: userCompanyId\}, modifier\);/);
    const applyAt = src.indexOf('await applyRootLicense(scan, module, company, user)');
    const persistAt = src.indexOf('await Scans.updateAsync({_id: scan._id, companyId: userCompanyId}, modifier)');
    expect(applyAt).toBeGreaterThan(-1);
    expect(persistAt).toBeGreaterThan(applyAt);
  });
});

describe('source lock - reprocessScan validates the id it is handed', () => {
  it('rejects anything but a plain string scan id', () => {
    const src = readCode(PROCESS_SCAN);
    const at = src.indexOf('async reprocessScan(id)');
    expect(at).toBeGreaterThan(-1);
    const body = src.slice(at, src.indexOf('\n  }', at));
    expect(body).toMatch(/asString\(id\)/);
    // non-vacuity: the raw argument must not reach processScan any more.
    expect(body).not.toMatch(/await processScan\(id, user\)/);
  });
});
