/* eslint-disable no-undef */
// ---------------------------------------------------------------------------
// The fix round.
//
// One spec per defect the three audits returned, each written to FAIL against
// the code as it was reported, so a later edit that reopens one of them fails
// loudly instead of silently reappearing in the next review.
//
//   1  REST forgery      - POST /api/v2/core/modules/:id could write the four audit
//                          fields, bypassing the compliance_manager|manager gate
//   1b unknown key       - the injector accepted any license key at all
//   2  discriminators    - findSelectedEntry took the first entry for the key
//                          rather than the first entry OF OURS
//   3  key bound         - COMPONENT_KEY_MAX mirrored the wrong schema
//   4  risk name         - a long component key truncated the LICENCE identifier
//   6  propagate         - an unvalidated moduleId reached two selectors
//   7  no cap            - licensesSelected could grow until the document died
//   8  key case          - a resolution silently never applied when the scan node
//                          and the catalogue component disagreed on case
//
// ROUND 2 - what the security re-review and QA returned on the round-1 fixes:
//
//   R1 proto bypass      - a top-level `__proto__` key in the REST body skipped
//                          the strip of defect 1 entirely (MAJOR, working PoC)
//   R2 case collision    - the defect-8 fallback applied a pick to a genuinely
//                          DIFFERENT package (a silent mis-application)
//   R3 $exists           - both Mongo selectors claimed entries the JS
//                          discriminator refuses (null / '')
//   R4 read-modify-write - the documented REST round trip destroyed a STORED
//                          audit trail
//   R5 author fallback   - 'unknown' collided with the UNKNOWN licence key
//
// The pure decisions are executed. The wiring - anything importing meteor/* -
// is locked structurally, in the same source-assertion style the license-injection wiring
// spec uses, with LINE comments stripped FIRST (the order is load-bearing; see
// source-assertion-vacuity.unit.spec.js).
// ---------------------------------------------------------------------------
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '../..');

function read(rel) {
  return fs.readFileSync(path.join(REPO, rel), 'utf8');
}

function stripComments(source) {
  return source
    .split('\n')
    .map((line) => (/^\s*\/\//.test(line) ? '' : line))
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

const REST_MODULES_JS = 'imports/server/rest-api/modules.js';
const RESOLVE_JS = 'imports/lib/interactors/modules/resolveComponentLicense.js';
const MODULE_METHODS_JS = 'imports/server/collections/modules.js';
const MODULE_SCHEMA_JS = 'imports/lib/schemas/moduleSchema.js';
const PROCESS_SCAN_JS = 'imports/server/scan/processScan.js';

const entry = require('../../imports/lib/licenseResolution/resolutionEntry');
const _ = require('underscore');
const {safeRequestBody, UNSAFE_BODY_KEYS} =
  require('../../imports/server/rest-api/safeRequestBody');
const {resolvedLicenseMap, injectableLicenseMap, injectResolvedLicenses} =
  require('../../imports/server/scan/componentLicensePick');
const CLEAR_JS = 'imports/lib/interactors/modules/clearComponentLicenseResolution.js';
const {buildLicenseRiskName} =
  require('../../imports/lib/licenseResolution/licenseRiskPlan');
const {RISK_NAME_MAX} = require('../../imports/lib/sarif/cweRiskPlan');

const AUDIT_FIELDS = ['justification', 'resolvedBy', 'resolvedById', 'resolvedAt'];

function ours(key, license, justification) {
  return {key, license, comment: entry.RESOLUTION_COMMENT,
    justification: justification === undefined ? 'because' : justification,
    resolvedBy: 'Ada Lovelace', resolvedById: 'u1', resolvedAt: new Date(0)};
}

function foreign(key, license) {
  return {key, license, comment: 'Multi-license pick by Ada, 01/01/2026'};
}

function moduleWith(entries) {
  return {componentConfig: {licensesSelected: entries}};
}

// ---------------------------------------------------------------------------
// Defect 1 (MAJOR) - the audit fields are not writable over REST
// ---------------------------------------------------------------------------

describe('the resolution audit fields cannot be supplied by a REST caller', () => {
  it('names exactly the four fields the resolve method owns', () => {
    expect(entry.RESOLUTION_AUDIT_FIELDS.slice().sort()).toEqual(AUDIT_FIELDS.slice().sort());
  });

  it('strips all four from every licensesSelected entry', () => {
    const cleaned = entry.stripResolutionAudit({licensesSelected: [
      ours('npm:left-pad', 'ACME-PRIVATE-1'),
      foreign('npm:b', 'ISC')
    ]});
    cleaned.licensesSelected.forEach((e) => {
      AUDIT_FIELDS.forEach((field) => expect(e).not.toHaveProperty(field));
    });
  });

  it('keeps every field a REST caller is allowed to write', () => {
    const cleaned = entry.stripResolutionAudit({licensesSelected: [
      {key: 'npm:a', version: '1.0.0', path: '/a/', license: 'MIT', comment: 'c',
        justification: 'forged', resolvedBy: 'Jane Doe, Head of Legal'}
    ]});
    expect(cleaned.licensesSelected[0])
      .toEqual({key: 'npm:a', version: '1.0.0', path: '/a/', license: 'MIT', comment: 'c'});
  });

  it('leaves the other componentConfig lists alone', () => {
    const supplied = {whitelist: [{key: 'npm:a', version: '*', comment: 'c'}],
      licensesSelected: [ours('npm:a', 'MIT')]};
    const cleaned = entry.stripResolutionAudit(supplied);
    expect(cleaned.whitelist).toEqual(supplied.whitelist);
  });

  it('does not mutate what the caller handed it', () => {
    const supplied = {licensesSelected: [ours('npm:a', 'MIT')]};
    entry.stripResolutionAudit(supplied);
    expect(supplied.licensesSelected[0]).toHaveProperty('justification');
  });

  it('survives a body that JSON.parse gave an own __proto__ key', () => {
    // Both the REST body parser and DDP produce documents through JSON.parse,
    // which DOES create an own `__proto__` property. `out[key] = value` on such
    // a key runs Object.prototype's setter instead of storing, so the forged
    // field vanishes from the copy while the copy's prototype is reassigned.
    const supplied = JSON.parse('{"licensesSelected": [{"key": "npm:a", "license": "MIT",' +
      ' "comment": "c", "__proto__": {"polluted": true}, "justification": "forged"}]}');
    const cleaned = entry.stripResolutionAudit(supplied);
    expect(cleaned.licensesSelected[0]).not.toHaveProperty('justification');
    expect({}.polluted).toBeUndefined();
    expect(Object.getPrototypeOf(cleaned.licensesSelected[0])).toBe(Object.prototype);
  });

  it('passes anything that is not a licensesSelected array straight through', () => {
    [undefined, null, 'nope', 7, [], {}, {licensesSelected: null},
      {licensesSelected: 'nope'}].forEach((value) => {
      expect(() => entry.stripResolutionAudit(value)).not.toThrow();
    });
    expect(entry.stripResolutionAudit({licensesSelected: [null, 7, 'x']})
      .licensesSelected).toEqual([null, 7, 'x']);
  });

  it('is applied by the REST module handler before the body is merged', () => {
    const live = stripComments(read(REST_MODULES_JS));
    expect(live).toMatch(/stripResolutionAudit/);
    const stripAt = live.indexOf('stripResolutionAudit(supplied)');
    const extendAt = live.indexOf('_.extend(safeBody');
    expect(stripAt).toBeGreaterThan(-1);
    expect(extendAt).toBeGreaterThan(stripAt);
    expect(live).toMatch(/from '\/imports\/lib\/licenseResolution\/resolutionEntry'/);
  });

  it('CANNOT BE SKIPPED: the body the handler tests is built by safeRequestBody', () => {
    // Round 2. Pinning the call site is not enough and never was: the strip is
    // guarded by hasOwnProperty(safeBody, 'componentConfig'), and a body whose
    // own `__proto__` key was assigned with `safeBody[key] = value` reassigned
    // safeBody's PROTOTYPE, so that guard answered false and the strip never
    // ran - while _.extend (createAssigner over _.allKeys) still lifted the
    // inherited componentConfig onto the target. 550 green tests missed it
    // because every one of them sent the direct shape.
    const live = stripComments(read(REST_MODULES_JS));
    expect(live).toMatch(/const safeBody = safeRequestBody\(body\);/);
    // The raw idiom this replaces must not come back.
    expect(live).not.toMatch(/safeBody\[key\] = value/);
    expect(live).toMatch(/from '\.\/safeRequestBody'/);
  });

  it('has no second mutating REST entry point that skips the strip', () => {
    // handlePost is the only route that writes a module document; there is no
    // handlePut - PUT and PATCH fall through to 405. If one is ever added it has
    // to run the same strip, and this is the assertion that fails when it does not.
    const live = stripComments(read(REST_MODULES_JS));
    expect(live.match(/this\.request\.method === '(POST|PUT|PATCH)'/g) || [])
      .toEqual(["this.request.method === 'POST'"]);
    expect(live).not.toMatch(/function handlePut|function handlePatch/);
    // ...and the one that does runs the strip before it merges anything.
    expect(live.match(/stripResolutionAudit\(/g).length).toBe(1);
    const handler = live.slice(live.indexOf('async function handlePost('),
      live.indexOf('async function handleGet('));
    expect(handler).toMatch(/stripResolutionAudit\(/);
  });
});

// ---------------------------------------------------------------------------
// Defect 1b - no write path may inject a license key the catalogue never had
// ---------------------------------------------------------------------------

describe('the injector refuses a license that resolves to nothing', () => {
  const names = {MIT: 'MIT License'};

  it('drops an entry whose license is in neither catalogue', () => {
    const map = injectableLicenseMap(moduleWith([
      ours('npm:a', 'MIT'), ours('npm:b', 'ACME-FORGED-1')
    ]), names, new Set(['MIT']));
    expect([...map.keys()]).toEqual(['npm:a']);
  });

  it('keeps a company-private key the caller resolved', () => {
    const map = injectableLicenseMap(moduleWith([ours('npm:a', 'ACME-PRIVATE-1')]),
      {'ACME-PRIVATE-1': 'ACME Private'}, new Set(['ACME-PRIVATE-1']));
    expect(map.get('npm:a')).toEqual({license: 'ACME-PRIVATE-1', name: 'ACME Private'});
  });

  it('fails CLOSED when the caller supplies no resolved key set at all', () => {
    // A future caller that forgets the argument must inject nothing, not
    // everything. This is the whole point of the separate function.
    expect(injectableLicenseMap(moduleWith([ours('npm:a', 'MIT')]), names).size).toBe(0);
    expect(injectableLicenseMap(moduleWith([ours('npm:a', 'MIT')]), names, {}).size).toBe(0);
  });

  it('reads the key set with Set.has, so a crafted key answers for itself only', () => {
    const map = injectableLicenseMap(moduleWith([ours('npm:a', 'constructor')]),
      {}, new Set(['MIT']));
    expect(map.size).toBe(0);
  });

  it('leaves resolvedLicenseMap as the plain discriminator it is', () => {
    // resolvedLicenseKeys builds the very query the key set comes from, so it
    // has to keep seeing every key, known or not.
    expect(resolvedLicenseMap(moduleWith([ours('npm:a', 'ACME-FORGED-1')])).size).toBe(1);
  });

  it('is what applyResolvedLicenses hands the walk', () => {
    const live = stripComments(read(PROCESS_SCAN_JS));
    expect(live).toMatch(/const map = injectableLicenseMap\(fresh, nameByKey, knownKeys\)/);
    expect(live).toMatch(/injectResolvedLicenses\(scan, map, rootKey\)/);
    // The set is built from the two things a key may resolve to, and nothing else.
    const at = live.indexOf('const knownKeys');
    expect(at).toBeGreaterThan(-1);
    const block = live.slice(at, live.indexOf('const map = injectableLicenseMap'));
    expect(block).toMatch(/knownKeys\.add\(license\.key\)/);
    expect(block).toMatch(/privateLicenses/);
  });
});

// ---------------------------------------------------------------------------
// Defect 2 - the three discriminators agree
// ---------------------------------------------------------------------------

describe('findSelectedEntry prefers OUR entry over a foreign one for the same key', () => {
  it('finds ours when a foreign entry for the same key precedes it', () => {
    const module = moduleWith([foreign('npm:a', 'ISC'), ours('npm:a', 'MIT')]);
    expect(entry.findSelectedEntry(module, 'npm:a').license).toBe('MIT');
    expect(entry.findResolution(module, 'npm:a').license).toBe('MIT');
  });

  it('still answers with a foreign entry when there is no resolution at all', () => {
    // findSelectedEntry keeps its "whoever wrote it" meaning: the resolve method
    // uses it to decide whether it is replacing an entry or appending one.
    const module = moduleWith([foreign('npm:a', 'ISC')]);
    expect(entry.findSelectedEntry(module, 'npm:a').license).toBe('ISC');
    expect(entry.findResolution(module, 'npm:a')).toBeNull();
  });

  it('takes the FIRST of ours, like the client and the injection map', () => {
    const module = moduleWith([ours('npm:a', 'FIRST'), ours('npm:a', 'SECOND')]);
    expect(entry.findSelectedEntry(module, 'npm:a').license).toBe('FIRST');
  });

  it('rewrites OUR entry rather than the one that happens to come first', () => {
    // The positional `$` resolves to the first element the SELECTOR matched, so
    // the selector has to name a justification-carrying entry. Without this an
    // identical-but-changed resubmit overwrites a multi-license pick and leaves
    // two resolution entries for one key.
    const live = stripComments(read(RESOLVE_JS));
    expect(live).toMatch(
      /\$elemMatch: \{key: componentKey, justification: OURS\}/);
    const elemAt = live.indexOf('$elemMatch');
    const keyAt = live.indexOf("'componentConfig.licensesSelected.key': componentKey");
    expect(elemAt).toBeGreaterThan(-1);
    expect(keyAt).toBeGreaterThan(elemAt);
  });
});

// ---------------------------------------------------------------------------
// Defect 3 - the component-key bound mirrors the schema the entry is stored in
// ---------------------------------------------------------------------------

describe('the component-key bound matches the field the entry is written to', () => {
  const block = (() => {
    const source = read(MODULE_SCHEMA_JS);
    return source.slice(source.indexOf('const SelectedLicensesEntrySchema'),
      source.indexOf('const ModuleComponentConfig'));
  })();

  function declaredMax(field) {
    const at = block.indexOf('\n  ' + field + ': {');
    const body = block.slice(at, block.indexOf('\n  }', at));
    const max = body.match(/\bmax:\s*(\d+)/);
    return max ? Number(max[1]) : null;
  }

  it('accepts exactly what SelectedLicensesEntrySchema.key holds', () => {
    expect(entry.COMPONENT_KEY_MAX).toBe(declaredMax('key'));
  });

  it('keeps the width the sibling component-key fields already use', () => {
    // BWComponentEntrySchema.key (whitelist/blacklist/unchanged/looseCoupled/
    // changedStatus - the sibling arrays of the SAME componentConfig) and
    // CustomComponentSchema.key are both 250. Lowering the resolution bound to
    // 100 instead would make an ordinary long scanner key
    // (`golang:github.com/<org>/<repo>/<deep>/<path>`) permanently unresolvable.
    const bw = read('imports/lib/schemas/bwlistSchema.js');
    const bwBlock = bw.slice(bw.indexOf('export const BWComponentEntrySchema'));
    expect(bwBlock.slice(0, bwBlock.indexOf('version:'))).toMatch(/max:\s*250/);
    expect(entry.COMPONENT_KEY_MAX).toBe(250);
  });

  it('accepts a real 250-character golang key', () => {
    const key = 'golang:github.com/acme/' + 'x'.repeat(250 - 'golang:github.com/acme/'.length);
    expect(key.length).toBe(250);
    expect(entry.validateResolutionInput({moduleId: 'm1', componentKey: key,
      license: 'MIT', justification: 'j'}).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Defect 4 - the risk name never mangles the licence identifier
// ---------------------------------------------------------------------------

describe('buildLicenseRiskName budgets the key so the licence always survives', () => {
  const LONG_KEY = 'golang:github.com/acme/' + 'deep/'.repeat(40);

  it('says "set manually to", matching the aside', () => {
    expect(buildLicenseRiskName('npm:left-pad', 'MIT'))
      .toBe('[npm:left-pad] License set manually to MIT');
  });

  it('never truncates a licence identifier into a different valid one', () => {
    const name = buildLicenseRiskName(LONG_KEY, 'GPL-3.0-or-later');
    expect(name.length).toBeLessThanOrEqual(RISK_NAME_MAX);
    expect(name.endsWith('License set manually to GPL-3.0-or-later')).toBe(true);
  });

  it('marks the key it had to cut, rather than cutting silently', () => {
    const name = buildLicenseRiskName(LONG_KEY, 'MIT');
    expect(name.charAt(0)).toBe('[');
    expect(name).toContain('...]');
    expect(name).toContain('golang:github.com/acme/');
  });

  it('leaves a key that fits completely alone', () => {
    expect(buildLicenseRiskName('maven:org.apache.commons:commons-lang3', 'Apache-2.0'))
      .toBe('[maven:org.apache.commons:commons-lang3] License set manually to Apache-2.0');
  });

  it('marks an over-long LICENCE as cut too, so it cannot read as an identifier', () => {
    // A private license key is never checked against SPDX, so it can be any
    // length. Truncating it silently would put a licence that does not exist
    // into an audit record.
    const name = buildLicenseRiskName('npm:a', 'ACME-' + 'X'.repeat(300));
    expect(name.length).toBeLessThanOrEqual(RISK_NAME_MAX);
    expect(name.endsWith('...')).toBe(true);
  });

  it('still names the component even when the licence eats the budget', () => {
    const name = buildLicenseRiskName(LONG_KEY, 'Y'.repeat(500));
    expect(name.length).toBeLessThanOrEqual(RISK_NAME_MAX);
    expect(name.charAt(0)).toBe('[');
    expect(name.indexOf(']')).toBeGreaterThan(3);
  });
});

// ---------------------------------------------------------------------------
// Defect 6 - PropagateLicensePicks validates its argument and checks a role
// ---------------------------------------------------------------------------

describe('Modules.PropagateLicensePicks is guarded like the write it performs', () => {
  const live = stripComments(read(MODULE_METHODS_JS));
  const handler = live.slice(live.indexOf('async function propagateLicensePicks('),
    live.indexOf("Meteor.methods({"));

  it('refuses a moduleId that is not a plain non-empty string', () => {
    // `{$ne: null}` in either selector picks an arbitrary module - and an
    // arbitrary scan - of the caller's own company, then writes module A's picks
    // into module B's scan. reprocessScan already carries this guard.
    expect(handler).toMatch(/typeof moduleId !== 'string'/);
    expect(handler).toMatch(/Meteor\.Error\(400,/);
    const guardAt = handler.indexOf("typeof moduleId !== 'string'");
    expect(guardAt).toBeGreaterThan(-1);
    expect(handler.indexOf('Modules.findOneAsync(')).toBeGreaterThan(guardAt);
  });

  it('requires the same two roles the resolve method does', () => {
    expect(handler).toMatch(/\['compliance_manager', 'manager'\]/);
    expect(handler).toMatch(/userIsInRole\(/);
    const roleAt = handler.indexOf('userIsInRole(');
    expect(handler.indexOf('applyResolvedLicenses(')).toBeGreaterThan(roleAt);
  });

  it('looks the scan up by the module it actually loaded', () => {
    expect(handler).toMatch(/Scans\.findOneAsync\(\{companyId, moduleId: module\._id\}/);
    expect(handler).not.toMatch(/Scans\.findOneAsync\(\{companyId, moduleId\}/);
  });
});

// ---------------------------------------------------------------------------
// Defect 7 - licensesSelected is capped
// ---------------------------------------------------------------------------

describe('licensesSelected cannot grow until the module document dies', () => {
  it('publishes one bound both the schema and the method use', () => {
    expect(entry.LICENSES_SELECTED_MAX).toBe(2000);
    const schema = stripComments(read(MODULE_SCHEMA_JS));
    expect(schema).toMatch(/maxCount: LICENSES_SELECTED_MAX/);
    expect(schema).toMatch(/from '\/imports\/lib\/licenseResolution\/resolutionEntry'/);
  });

  it('counts what is stored, ignoring junk', () => {
    expect(entry.selectedEntryCount(moduleWith([ours('a', 'MIT'), foreign('b', 'ISC')]))).toBe(2);
    [undefined, null, {}, {componentConfig: {}},
      {componentConfig: {licensesSelected: 'nope'}}]
      .forEach((m) => expect(entry.selectedEntryCount(m)).toBe(0));
  });

  it('is checked by the resolve method before it appends a new entry', () => {
    const live = stripComments(read(RESOLVE_JS));
    expect(live).toMatch(/LICENSES_SELECTED_MAX/);
    const capAt = live.indexOf('LICENSES_SELECTED_MAX');
    const pushAt = live.indexOf('$push');
    expect(capAt).toBeGreaterThan(-1);
    expect(pushAt).toBeGreaterThan(capAt);
    // ...and only when it would ADD one: a module at the cap must still be able
    // to correct a resolution it already carries.
    expect(live).toMatch(/!existing && entryCount >= LICENSES_SELECTED_MAX/);
  });
});

// ---------------------------------------------------------------------------
// Defect 8 - a resolution applies whichever case the scan node spells
// ---------------------------------------------------------------------------

describe('the injection matches a component key case-insensitively', () => {
  // createComponentFromDependency stores `clearSpdxKey(dependency.key)` (lower
  // cased) WITHOUT writing it back onto dependency.key, while
  // updateComponentFromDependency does. For a component that was not already in
  // the catalogue the scan node and the component document can therefore
  // disagree on case, and an exact-equality match silently applies nothing.
  const map = () => injectableLicenseMap(moduleWith([ours('npm:Left-Pad', 'MIT')]),
    {MIT: 'MIT License'}, new Set(['MIT']));

  it('applies a resolution stored under a different case', () => {
    const node = {key: 'npm:left-pad', licenses: [{key: 'ISC', name: 'ISC'}]};
    const result = injectResolvedLicenses({dependencies: [node]}, map(), null);
    expect(result.nodes).toBe(1);
    expect(node.licenses[0].key).toBe('MIT');
    expect(node.licenses[1]).toEqual({key: 'ISC', name: 'ISC'});
  });

  it('applies ONLY to the exact node when the tree carries both spellings', () => {
    // Round 2 (security Minor 3 / QA D5) TIGHTENED THIS. It used to write both
    // nodes. The fallback exists for ONE reason - the stored key and the scan
    // node disagree on case because clearSpdxKey lower-cased one of them - and
    // that reason evaporates the moment the tree spells the stored key exactly.
    // github.com/Sirupsen/logrus and github.com/sirupsen/logrus genuinely
    // co-occur in Go trees, and they are different packages.
    const exact = {key: 'npm:Left-Pad'};
    const lower = {key: 'npm:left-pad'};
    const result = injectResolvedLicenses({dependencies: [exact, lower]}, map(), null);
    expect(result.nodes).toBe(1);
    expect(result.keys).toEqual(['npm:Left-Pad']);
    expect(exact.licenses[0].key).toBe('MIT');
    expect(lower.licenses).toBeUndefined();
  });

  it('does not make a genuinely different key match', () => {
    const node = {key: 'npm:right-pad'};
    expect(injectResolvedLicenses({dependencies: [node]}, map(), null).nodes).toBe(0);
    expect(node.licenses).toBeUndefined();
  });

  it('leaves the EXACT root skip exact', () => {
    // The loosened lookup must not loosen the skip: rootKey is read off the root
    // node of this very scan, so an exact comparison always identifies it, and a
    // node whose key merely differs in case from the root's is a different
    // package that must stay resolvable. Pinned by
    // component-license-injection-hostile's "never by prefix or by case".
    const root = {key: 'npm:Left-Pad'};
    expect(injectResolvedLicenses({dependencies: [root]}, map(), 'npm:Left-Pad').nodes).toBe(0);
    expect(root.licenses).toBeUndefined();
    // ...and round 2 (security Minor 4) made the OTHER half unconditional: the
    // root's key is spoken for by applyRootLicense, so the fallback may not hand
    // the root's pick to a node that merely differs from it in case either.
    const sibling = {key: 'npm:left-pad'};
    expect(injectResolvedLicenses({dependencies: [sibling]}, map(), 'npm:Left-Pad').nodes).toBe(0);
    expect(sibling.licenses).toBeUndefined();
  });

  it('keeps a crafted key answering for itself only', () => {
    const node = {key: 'npm:a'};
    const crafted = injectableLicenseMap(moduleWith([ours('__proto__', 'MIT')]),
      {MIT: 'MIT License'}, new Set(['MIT']));
    expect(injectResolvedLicenses({dependencies: [node]}, crafted, null).nodes).toBe(0);
    expect({}.licenses).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Defect 9 - the audit line counts in English
// ---------------------------------------------------------------------------

describe('the applied-licenses log entry pluralises', () => {
  it('says "1 dependency", not "1 dependencies"', () => {
    const live = stripComments(read(PROCESS_SCAN_JS));
    expect(live).toMatch(/applied\.nodes === 1 \? ' dependency' : ' dependencies'/);
    expect(live).not.toMatch(/applied\.nodes \+ ' dependencies/);
  });
});

// ---------------------------------------------------------------------------
// Defect 5 - the catalogue seed text
// ---------------------------------------------------------------------------

describe('the NO-LICENSE seed text is grammatical', () => {
  const {CATCH_ALL_LICENSE_SEEDS} =
    require('../../imports/lib/licenseResolution/catchAllLicenses');
  const noLicense = CATCH_ALL_LICENSE_SEEDS.find((s) => s.key === 'NO-LICENSE');

  it('drops the "were"/"the licenses ... is" errors it inherited', () => {
    expect(noLicense.text).not.toMatch(/situations were/);
    expect(noLicense.text).not.toMatch(/the licenses of a component is/);
  });

  it('points at the value that covers the other case', () => {
    expect(noLicense.text).toContain('UNKNOWN');
  });

  it('uses no em-dash or en-dash', () => {
    CATCH_ALL_LICENSE_SEEDS.forEach((s) => {
      expect(s.text).not.toMatch(/[\u2013\u2014]/);
    });
  });
});

// ---------------------------------------------------------------------------
// ROUND 2, defect R1 (MAJOR) - the strip cannot be skipped
//
// EXECUTED, not asserted about. The round-1 spec proved stripResolutionAudit is
// correct and that handlePost calls it; neither statement was false, and the
// endpoint was exploitable anyway. So this block replays the handler's own merge
// - safeRequestBody, then the hasOwnProperty guard, then the two _.extend calls
// against the repo's own underscore - and looks at what a Mongo $set would have
// received.
// ---------------------------------------------------------------------------

describe('a top-level __proto__ key cannot skip the REST audit strip', () => {
  const FORGED = '{"componentConfig": {"licensesSelected": [{"key": "npm:left-pad",' +
    ' "license": "MIT", "comment": "c", "justification": "forged",' +
    ' "resolvedBy": "Jane Doe, Head of Legal", "resolvedById": "someone-else",' +
    ' "resolvedAt": "2026-09-01T00:00:00.000Z"}]}}';

  // The handler's merge, verbatim in shape, with the body as JSON.parse produces
  // it. `current` is the projection handlePost reads back before merging.
  function mergeLikeHandler(body) {
    const safeBody = safeRequestBody(body);
    if (Object.prototype.hasOwnProperty.call(safeBody, 'componentConfig')) {
      safeBody.componentConfig = entry.stripResolutionAudit(safeBody.componentConfig);
    }
    return _.extend({name: 'm', moduleIdentifier: 'mi'},
      _.extend(safeBody, {companyId: 'c1'}));
  }

  function auditFieldsIn(merged) {
    const selected = ((merged.componentConfig || {}).licensesSelected) || [];
    return selected.reduce((found, e) => found.concat(
      AUDIT_FIELDS.filter((f) => e && Object.prototype.hasOwnProperty.call(e, f))), []);
  }

  it('reproduces the PoC body: JSON.parse really does make __proto__ an own key', () => {
    const body = JSON.parse('{"__proto__": ' + FORGED + '}');
    expect(Object.prototype.hasOwnProperty.call(body, '__proto__')).toBe(true);
  });

  it('does not let the forged audit trail reach the merged document', () => {
    const merged = mergeLikeHandler(JSON.parse('{"__proto__": ' + FORGED + '}'));
    expect(auditFieldsIn(merged)).toEqual([]);
    // The whole inherited config is dropped, so there is nothing to write at all.
    expect(Object.prototype.hasOwnProperty.call(merged, 'componentConfig')).toBe(false);
  });

  it('still strips the direct shape the round-1 test sent', () => {
    const merged = mergeLikeHandler(JSON.parse(FORGED));
    expect(auditFieldsIn(merged)).toEqual([]);
    expect(merged.componentConfig.licensesSelected[0])
      .toEqual({key: 'npm:left-pad', license: 'MIT', comment: 'c'});
  });

  it('never reassigns the prototype of the object it builds', () => {
    const safe = safeRequestBody(JSON.parse('{"__proto__": {"componentConfig": 1}}'));
    expect(safe.componentConfig).toBeUndefined();
    expect(Object.getPrototypeOf(safe)).toBeNull();
    expect({}.componentConfig).toBeUndefined();
  });

  it('drops constructor and prototype as well as __proto__', () => {
    expect(UNSAFE_BODY_KEYS.slice().sort())
      .toEqual(['__proto__', 'constructor', 'prototype']);
    const safe = safeRequestBody(JSON.parse(
      '{"constructor": {"x": 1}, "prototype": {"y": 2}, "name": "keep"}'));
    expect(Object.keys(safe)).toEqual(['name']);
  });

  it('keeps stripping $-prefixed keys, which is what it was there for', () => {
    const safe = safeRequestBody({$where: '1==1', $set: {a: 1}, name: 'keep', 'a.b': 1});
    expect(Object.keys(safe).sort()).toEqual(['a.b', 'name']);
  });

  it('copies only own enumerable keys, and copies nothing off a hostile prototype', () => {
    const hostile = Object.create({inherited: 'nope'});
    hostile.name = 'keep';
    expect(Object.keys(safeRequestBody(hostile))).toEqual(['name']);
  });

  it('answers an empty body with an empty object rather than throwing', () => {
    [undefined, null, '', 0, 'nope', 7].forEach((body) => {
      expect(Object.keys(safeRequestBody(body))).toEqual([]);
    });
    expect(Object.keys(safeRequestBody([1, 2]))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// ROUND 2, defect R2 (security Minor 3 / QA D5) - the case fallback is
// unambiguous-only, and never overrides a key the tree spells exactly
// ---------------------------------------------------------------------------

describe('the case fallback never applies a pick to a different package', () => {
  const names = {MIT: 'MIT License', ISC: 'ISC License'};
  const mapFor = (entries) => injectableLicenseMap(moduleWith(entries), names,
    new Set(['MIT', 'ISC']));

  it('applies NOTHING when two resolutions collide on the same lower-cased key', () => {
    // lowerCaseIndex was last-wins, so `npm:FOO` silently took whichever of
    // npm:Foo / npm:foo happened to be stored later - and the aside, which
    // matches exactly, showed no resolution at all while the stored scan, the
    // analyzer and the SBOM carried a licence picked for another component.
    const node = {key: 'npm:FOO'};
    const result = injectResolvedLicenses({dependencies: [node]},
      mapFor([ours('npm:Foo', 'MIT'), ours('npm:foo', 'ISC')]), null);
    expect(result).toEqual({nodes: 0, keys: []});
    expect(node.licenses).toBeUndefined();
  });

  it('still applies each of the colliding pair to its own exact node', () => {
    const upper = {key: 'npm:Foo'};
    const lower = {key: 'npm:foo'};
    const result = injectResolvedLicenses({dependencies: [upper, lower]},
      mapFor([ours('npm:Foo', 'MIT'), ours('npm:foo', 'ISC')]), null);
    expect(result.nodes).toBe(2);
    expect(upper.licenses[0].key).toBe('MIT');
    expect(lower.licenses[0].key).toBe('ISC');
  });

  it('leaves Sirupsen/logrus alone when only sirupsen/logrus was resolved', () => {
    // QA's real-world instance. Both spellings genuinely occur in one Go tree.
    const resolved = {key: 'golang:github.com/sirupsen/logrus'};
    const other = {key: 'golang:github.com/Sirupsen/logrus'};
    const result = injectResolvedLicenses({dependencies: [resolved, other]},
      mapFor([ours('golang:github.com/sirupsen/logrus', 'MIT')]), null);
    expect(result).toEqual({nodes: 1, keys: ['golang:github.com/sirupsen/logrus']});
    expect(other.licenses).toBeUndefined();
  });

  it('keeps the defect-8 fix: the fallback still fires when nothing matches exactly', () => {
    const node = {key: 'npm:left-pad'};
    const result = injectResolvedLicenses({dependencies: [node]},
      mapFor([ours('npm:Left-Pad', 'MIT')]), null);
    expect(result).toEqual({nodes: 1, keys: ['npm:left-pad']});
    expect(node.licenses[0].key).toBe('MIT');
  });

  it('reports the keys it applied, so a case divergence is visible', () => {
    const result = injectResolvedLicenses(
      {dependencies: [{key: 'npm:b'}, {key: 'npm:a'}]},
      mapFor([ours('npm:a', 'MIT'), ours('npm:b', 'ISC')]), null);
    expect(result.keys).toEqual(['npm:a', 'npm:b']);
  });

  it('names those keys in the componentLicensesApplied audit entry', () => {
    // applied.keys was computed and thrown away. A resolution that landed on a
    // differently-cased node has to be readable somewhere.
    const live = stripComments(read(PROCESS_SCAN_JS));
    const at = live.indexOf("'componentLicensesApplied'");
    expect(at).toBeGreaterThan(-1);
    const block = live.slice(live.indexOf('const applied = injectResolvedLicenses'), at);
    expect(block).toMatch(/applied\.keys/);
  });
});

// ---------------------------------------------------------------------------
// ROUND 2, defect R3 (security Minor 2) - the Mongo selectors match exactly what
// the JS discriminator does
// ---------------------------------------------------------------------------

describe('the selectors mirror hasJustification instead of $exists', () => {
  it('hasJustification refuses null, "" and whitespace', () => {
    [undefined, null, '', '   ', '\t\n', 0, 7, {}, []].forEach((justification) => {
      expect(entry.hasJustification({key: 'npm:a', justification})).toBe(false);
    });
    expect(entry.hasJustification({key: 'npm:a', justification: ' x '})).toBe(true);
  });

  it('the resolve $elemMatch requires a non-empty string, like the JS does', () => {
    const live = stripComments(read(RESOLVE_JS));
    expect(live).toMatch(/const OURS = \{\$type: 'string', \$regex: \/\\S\/\};/);
    expect(live).not.toMatch(/justification: \{\$exists: true\}/);
  });

  it('the undo $pull requires the same, and the two stay identical', () => {
    const live = stripComments(read(CLEAR_JS));
    expect(live).toMatch(/const OURS = \{\$type: 'string', \$regex: \/\\S\/\};/);
    expect(live).toMatch(/justification: OURS/);
    expect(live).not.toMatch(/justification: \{\$exists: true\}/);
  });
});

// ---------------------------------------------------------------------------
// ROUND 2, defect R4 (QA D4) - the documented REST round trip keeps the audit
// trail it was handed
// ---------------------------------------------------------------------------

describe('a REST read-modify-write does not destroy a stored resolution', () => {
  const stored = [ours('npm:left-pad', 'MIT', 'Legal signed off')];

  // What GET returns, and therefore what a client POSTs back: the strip removes
  // the four fields, and the restore has to put the STORED ones back.
  function roundTrip(supplied, storedEntries) {
    return entry.restoreResolutionAudit(entry.stripResolutionAudit(supplied),
      storedEntries === undefined ? stored : storedEntries);
  }

  it('puts the stored audit trail back on an entry sent back unchanged', () => {
    const out = roundTrip({licensesSelected: [
      {key: 'npm:left-pad', license: 'MIT', comment: entry.RESOLUTION_COMMENT,
        justification: 'Legal signed off', resolvedBy: 'Ada Lovelace',
        resolvedById: 'u1', resolvedAt: new Date(0)}]});
    expect(out.licensesSelected[0]).toEqual(stored[0]);
  });

  it('restores what is STORED, never what the caller sent', () => {
    const out = roundTrip({licensesSelected: [
      {key: 'npm:left-pad', license: 'MIT', comment: 'c',
        justification: 'forged', resolvedBy: 'Jane Doe, Head of Legal',
        resolvedById: 'someone-else', resolvedAt: '2026-09-01T00:00:00.000Z'}]});
    expect(out.licensesSelected[0].justification).toBe('Legal signed off');
    expect(out.licensesSelected[0].resolvedBy).toBe('Ada Lovelace');
    expect(out.licensesSelected[0].resolvedById).toBe('u1');
    expect(out.licensesSelected[0].resolvedAt).toEqual(new Date(0));
  });

  it('does not let the caller relabel a resolution it may not write', () => {
    // key and license are pinned to what is stored by the match itself, so
    // `comment` - the one-line label rendered beside the author - is the last
    // field a forger could still vary. A matched entry comes back whole.
    const out = roundTrip({licensesSelected: [
      {key: 'npm:left-pad', license: 'MIT', comment: 'Approved by the CFO'}]});
    expect(out.licensesSelected[0]).toEqual(stored[0]);
    expect(out.licensesSelected[0].comment).toBe(entry.RESOLUTION_COMMENT);
  });

  it('does NOT re-attribute a licence the caller changed', () => {
    // Changing the pick over a path with no role check is a real change; keeping
    // the old author on it would say a compliance manager determined a licence
    // they never saw.
    const out = roundTrip({licensesSelected: [
      {key: 'npm:left-pad', license: 'GPL-3.0-or-later', comment: 'c'}]});
    AUDIT_FIELDS.forEach((f) => expect(out.licensesSelected[0]).not.toHaveProperty(f));
  });

  it('leaves an entry for a component that carries no resolution alone', () => {
    const out = roundTrip({licensesSelected: [{key: 'npm:other', license: 'ISC'}]});
    expect(out.licensesSelected[0]).toEqual({key: 'npm:other', license: 'ISC'});
  });

  it('ignores a stored entry that is not ours', () => {
    const out = roundTrip({licensesSelected: [{key: 'npm:a', license: 'ISC'}]},
      [foreign('npm:a', 'ISC')]);
    AUDIT_FIELDS.forEach((f) => expect(out.licensesSelected[0]).not.toHaveProperty(f));
  });

  it('takes the first stored resolution for a key, like findResolution', () => {
    const out = roundTrip({licensesSelected: [{key: 'npm:a', license: 'MIT'}]},
      [foreign('npm:a', 'MIT'), ours('npm:a', 'MIT', 'first'), ours('npm:a', 'MIT', 'second')]);
    expect(out.licensesSelected[0].justification).toBe('first');
  });

  it('never mutates, and survives every malformed shape', () => {
    const supplied = {licensesSelected: [{key: 'npm:left-pad', license: 'MIT'}]};
    roundTrip(supplied);
    expect(supplied.licensesSelected[0]).not.toHaveProperty('justification');
    [undefined, null, 'nope', 7, [], {}, {licensesSelected: null}].forEach((value) => {
      expect(() => entry.restoreResolutionAudit(value, stored)).not.toThrow();
    });
    expect(entry.restoreResolutionAudit({licensesSelected: [null, 7, 'x']}, stored)
      .licensesSelected).toEqual([null, 7, 'x']);
    expect(() => entry.restoreResolutionAudit({licensesSelected: [{key: 'a'}]}, 'nope'))
      .not.toThrow();
  });

  it('reads a component key with Map.get, so __proto__ answers for itself only', () => {
    const out = entry.restoreResolutionAudit({licensesSelected: [
      {key: '__proto__', license: 'MIT'}]}, stored);
    AUDIT_FIELDS.forEach((f) => expect(out.licensesSelected[0]).not.toHaveProperty(f));
  });

  it('is wired into handlePost, with the stored entries it needs projected', () => {
    const live = stripComments(read(REST_MODULES_JS));
    expect(live).toMatch(/restoreResolutionAudit\(/);
    const stripAt = live.indexOf('stripResolutionAudit(supplied)');
    const restoreAt = live.indexOf('restoreResolutionAudit(');
    const extendAt = live.indexOf('_.extend(safeBody');
    expect(restoreAt).toBeGreaterThan(stripAt);
    expect(extendAt).toBeGreaterThan(restoreAt);
    expect(live).toMatch(/fields: \{'componentConfig\.licensesSelected': 1\}/);
    // The projection that feeds the MERGE stays narrow: widening it would make
    // $set: module write a componentConfig holding only licensesSelected and
    // wipe whitelist/blacklist/unchanged/looseCoupled with it.
    expect(live).toMatch(/fields:\{name:1, moduleIdentifier:1\}/);
  });
});

// ---------------------------------------------------------------------------
// ROUND 2, defect R5 (copy-editor ruling B) - the author fallback cannot be read
// as a licence key
// ---------------------------------------------------------------------------

describe('an unnameable author is not called "unknown"', () => {
  it('reads as a person, mid-sentence, and never as the UNKNOWN licence', () => {
    // The panel renders `Set by {resolvedBy}` a few lines under `<b>UNKNOWN</b>`
    // when that catch-all key was picked, and the literal is PERSISTED, so it
    // reaches REST consumers too.
    expect(entry.UNKNOWN_AUTHOR).toBe('an unidentified user');
    expect(entry.UNKNOWN_AUTHOR.toUpperCase()).not.toBe('UNKNOWN');
  });

  it('fits the field it is stored in', () => {
    expect(entry.UNKNOWN_AUTHOR.length).toBeLessThanOrEqual(200);
  });

  it('is what an unnameable user gets, and only then', () => {
    expect(entry.buildResolutionEntry({componentKey: 'npm:a', license: 'MIT',
      justification: 'j', user: {_id: 'u1'}}).resolvedBy).toBe('an unidentified user');
    expect(entry.buildResolutionEntry({componentKey: 'npm:a', license: 'MIT',
      justification: 'j', user: {_id: 'u1', profile: {name: 'Ada Lovelace'}}}).resolvedBy)
      .toBe('Ada Lovelace');
  });
});
