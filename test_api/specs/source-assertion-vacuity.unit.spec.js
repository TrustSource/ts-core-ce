/* eslint-disable no-undef */
// ---------------------------------------------------------------------------
// The guard on the repo's own source-assertion technique.
//
// Several suites here assert on SOURCE text rather than behaviour, because
// `yarn meteor-test` is broken at boot and the wiring they lock down cannot be
// required under Jest. Every one of them strips comments first, because the
// files they read carry long comments naming the very identifiers under
// assertion - a comment-blind `not.toMatch` passes on prose alone.
//
// THE FAILURE MODE THIS FILE EXISTS FOR
//
// The strip itself can go wrong, and when it does it fails SILENTLY and in the
// safe-looking direction. `cwe-risk-wiring.source.unit.spec.js` removes BLOCK
// comments before LINE comments. Three of the interactors in this repo carry the
// header line
//
//     // SERVER-ONLY BY CONTRACT. Never import from imports/client/**.
//
// whose trailing `/**` reads as an OPENING block delimiter to a block-first pass.
// Everything up to the next JSDoc `*/` - i.e. most of the file the assertions are
// about - is deleted, and every `not.toMatch` in the suite still "passes".
//
// So this file asserts, executably:
//
//   1. POSITIVE CONTROLS. For every source file the license-pick source assertions read,
//      the stripped text still contains tokens that are definitely live code.
//      A strip that swallows a file fails here instead of passing quietly.
//   2. The hazard is REAL and currently live in this repo, demonstrated on the
//      actual file rather than asserted from memory.
//   3. The license-pick wiring spec strips line comments FIRST, so an edit that
//      "tidies" the order back fails loudly.
// ---------------------------------------------------------------------------
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '../..');

function read(rel) {
  return fs.readFileSync(path.join(REPO, rel), 'utf8');
}

// The order license-resolution-wiring.source.unit.spec.js uses: whole-line
// comments are blanked BEFORE block comments are removed, so a `/*` that only
// exists inside a line comment can never open a block.
function stripLineFirst(source) {
  return source
    .split('\n')
    .map((line) => (/^\s*\/\//.test(line) ? '' : line))
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

// The order cwe-risk-wiring.source.unit.spec.js uses. Kept here as the CONTROL,
// not as a recommendation.
function stripBlockFirst(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => (/^\s*\/\//.test(line) ? '' : line))
    .join('\n');
}

// The order root-component-license.unit.spec.js's `readCode` uses: block
// comments, then ANY `//` not preceded by a colon (so `http://` survives).
function stripReadCode(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

// Every file the license-pick source assertions read, with a token that is unambiguously
// LIVE CODE in it - never a word that also appears in the file's prose.
const LIVE_TOKENS = [
  ['imports/lib/interactors/modules/resolveComponentLicense.js',
    ['export default resolveComponentLicense;', 'Meteor.userAsync()',
      "throw new Meteor.Error(403, AD)", 'Modules.updateAsync(']],
  ['imports/lib/interactors/modules/clearComponentLicenseResolution.js',
    ['export default clearComponentLicenseResolution;', '$pull:',
      'validateComponentTarget({moduleId, componentKey})']],
  ['imports/lib/interactors/riskProperties/reconcileLicenseRisk.js',
    ['export default reconcileLicenseRisk;', 'RiskProperties.insertAsync(',
      'RiskProperties.updateAsync(', "return 'skipped';", 'UNTOUCHED_RISK_STATES']],
  ['imports/lib/interactors/modules/index.js',
    ['ModulesResolveComponentLicense', 'ModulesClearComponentLicenseResolution']],
  ['imports/lib/interactors/riskProperties/index.js',
    ['RiskPropertiesReconcileLicenseRisk']],
  ['imports/startup/server/modules.js',
    ["'Modules.ResolveComponentLicense':", "'Modules.ClearComponentLicenseResolution':"]],
  ['imports/server/collections/modules.js',
    ["'Modules.PropagateLicensePicks':", "'Modules.PropagateRootLicense':"]],
  ['imports/server/scan/processScan.js',
    ['export async function applyResolvedLicenses(', 'injectResolvedLicenses(scan, map, rootKey)',
      'function mapLicenseFromScanLicense', 'withoutRootPickLicenses(dependency.licenses)']],
  ['imports/server/scan/rootDependency.js',
    ['const isRootPickLicense = isInjectedLicense', 'module.exports = {',
      "const COMPONENT_LICENSE_ORIGIN = 'ts-component-pick';"]],
  ['imports/server/scan/componentLicensePick.js',
    ['function injectResolvedLicenses(', 'module.exports = {', 'function resolvedLicenseMap(']],
  ['imports/lib/licenseResolution/catchAllLicenses.js',
    ['module.exports = {', 'const CATCH_ALL_LICENSE_KEYS =']],
  ['imports/lib/licenseResolution/licenseRiskPlan.js',
    ['module.exports = {', 'function safeRiskNameSegment(']],
  ['imports/lib/licenseResolution/resolutionEntry.js',
    ['module.exports = {', 'function validateResolutionInput(']],
  ['imports/lib/interactors/riskProperties/managedFields.js', ["'autoLicense'"]],
  ['imports/lib/schemas/riskSchema.js', ['autoLicense:']],
  ['imports/lib/schemas/moduleSchema.js',
    ['const SelectedLicensesEntrySchema', 'justification:']],
  ['imports/lib/sarif/cweRiskPlan.js', ['module.exports = {', 'function escapeKeySegment(']],
  ['imports/startup/server/fixtures.js',
    ['function ensureCatalogueLicense', 'CATCH_ALL_LICENSE_SEEDS']],
  ['imports/server/logEvent.js',
    ["key:'componentLicenseResolved'", "key:'componentLicenseResolutionCleared'",
      "key:'licenseRiskCreated'", "key:'licenseRiskUpdated'",
      "key:'componentLicensesApplied'"]]
];

describe('positive controls - the #139 strip never swallows a file it asserts on', () => {
  LIVE_TOKENS.forEach(([rel, tokens]) => {
    it(rel + ' survives the line-comments-first strip', () => {
      const live = stripLineFirst(read(rel));
      tokens.forEach((token) => {
        if (live.indexOf(token) === -1) {
          throw new Error(rel + ': the stripped source no longer contains ' +
            JSON.stringify(token) + ' - every `not.toMatch` asserted against this ' +
            'file is now vacuous. Check for a `/*` inside a comment.');
        }
      });
    });
  });

  it('keeps a sane proportion of every file, not a fragment of it', () => {
    // A cruder tripwire than the token list, and one that needs no maintenance:
    // stripping comments from a source file should not leave under a fifth of it.
    LIVE_TOKENS.forEach(([rel]) => {
      const raw = read(rel);
      const live = stripLineFirst(raw);
      expect(live.length / raw.length).toBeGreaterThan(0.2);
    });
  });
});

describe('the hazard is real, and is demonstrated rather than described', () => {
  const HEADER = '// SERVER-ONLY BY CONTRACT. Never import from imports/client/**.';
  const SERVER_ONLY = [
    'imports/lib/interactors/modules/resolveComponentLicense.js',
    'imports/lib/interactors/modules/clearComponentLicenseResolution.js',
    'imports/lib/interactors/riskProperties/reconcileLicenseRisk.js'
  ];

  it('every server-only interactor of #139 carries the header that can open a block', () => {
    SERVER_ONLY.forEach((rel) => {
      expect(read(rel)).toContain(HEADER);
      expect(HEADER).toContain('/**');
    });
  });

  it('a block-comments-first strip really does swallow live code today', () => {
    // Not hypothetical. reconcileLicenseRisk.js has a JSDoc block after the
    // header, so a block-first pass deletes everything between them - including
    // the whole insert branch.
    const rel = 'imports/lib/interactors/riskProperties/reconcileLicenseRisk.js';
    const raw = read(rel);
    const lineFirst = stripLineFirst(raw);
    const blockFirst = stripBlockFirst(raw);

    expect(lineFirst).toContain('RiskProperties.insertAsync(');
    expect(blockFirst).not.toContain('RiskProperties.insertAsync(');
    expect(blockFirst.length).toBeLessThan(lineFirst.length);
  });

  it('a comment-blind `not.toMatch` would still have passed on the swallowed file', () => {
    // The reason this is dangerous rather than merely wrong: the suite stays
    // green. Every negative assertion holds trivially on text that is gone.
    const blockFirst = stripBlockFirst(
      read('imports/lib/interactors/riskProperties/reconcileLicenseRisk.js'));
    expect(blockFirst).not.toMatch(/RiskProperties\.insertAsync\(/);
    expect(blockFirst).not.toMatch(/userName:/);
    expect(blockFirst).not.toMatch(/'riskProperties\.state'/);
  });
});

describe('the specs that assert on source keep a safe stripping order', () => {
  const WIRING_SPEC = 'test_api/specs/license-resolution-wiring.source.unit.spec.js';

  it('the #139 wiring spec removes line comments before block comments', () => {
    // Pinned so a later "tidy-up" that swaps the two lines fails here rather
    // than turning the whole suite vacuous.
    const src = read(WIRING_SPEC);
    const at = src.indexOf('function stripComments');
    expect(at).toBeGreaterThan(-1);
    const body = src.slice(at, src.indexOf('\n}', at));
    const lineAt = body.indexOf("/^\\s*\\/\\//");
    const blockAt = body.indexOf('\\/\\*[\\s\\S]*?\\*\\/');
    expect(lineAt).toBeGreaterThan(-1);
    expect(blockAt).toBeGreaterThan(-1);
    expect(lineAt).toBeLessThan(blockAt);
  });

  it('root-component-license\'s readCode still reaches the code it asserts on', () => {
    // That helper strips BLOCK comments first (the fragile order). It happens to
    // be safe on processScan.js today because no line comment there opens a
    // block - but "happens to be safe" is exactly what needs a control.
    const live = stripReadCode(read('imports/server/scan/processScan.js'));
    ['function mapLicenseFromScanLicense', 'withoutRootPickLicenses(dependency.licenses)',
      'stripInjectedRootLicenses(', 'async function applyRootLicense'].forEach((token) => {
      expect(live).toContain(token);
    });
    const liveRoot = stripReadCode(read('imports/server/scan/rootDependency.js'));
    expect(liveRoot).toContain('const isRootPickLicense = isInjectedLicense');
    expect(liveRoot).toContain('module.exports = {');
  });

  it('no file #139 asserts on would be swallowed by the fragile order either', () => {
    // Belt and braces for the OTHER order, since root-component-license.unit.spec.js
    // uses it and any new source spec may copy it. Reported, not silently ignored:
    // the failure message names the file so the fix is obvious.
    const fragile = [];
    LIVE_TOKENS.forEach(([rel, tokens]) => {
      const live = stripBlockFirst(read(rel));
      tokens.forEach((token) => {
        if (live.indexOf(token) === -1) fragile.push(rel + ' -> ' + token);
      });
    });
    // reconcileLicenseRisk.js is the KNOWN member of this set (demonstrated
    // above), so it is spelled out rather than tolerated by a loose assertion:
    // a SECOND file joining it has to be a reviewed change.
    expect(fragile).toEqual([
      'imports/lib/interactors/riskProperties/reconcileLicenseRisk.js -> ' +
        'RiskProperties.insertAsync(',
      'imports/lib/interactors/riskProperties/reconcileLicenseRisk.js -> ' +
        'RiskProperties.updateAsync('
    ]);
  });
});
