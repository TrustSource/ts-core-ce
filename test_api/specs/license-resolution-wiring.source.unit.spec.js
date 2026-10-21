/* eslint-disable no-undef */
// The wiring guards.
//
// The decisions of this feature are pure functions and are tested as such
// (license-resolution-entry, license-risk-plan, component-license-injection,
// catch-all-licenses). What is NOT reachable from Jest is the wiring: the method
// registration and its alias, the gate chain inside the interactors, the atomic
// write that survives a DDP retry, the ordering of the injection against the
// component write path, the idempotent catalogue seed, and the promise that the
// server-only interactors never reach the browser bundle.
//
// `yarn meteor-test` is broken at boot in this repo (Meteor 3.5 + Node 24), so
// those guarantees are locked structurally, in the source-assertion style
// established by cwe-risk-wiring.source.unit.spec.js.
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '../..');

function read(rel) {
  return fs.readFileSync(path.join(REPO, rel), 'utf8');
}

// Comment-blind assertions pass on prose alone; every file below carries long
// comments naming the very identifiers under assertion.
//
// LINE comments are removed FIRST, and that order is load-bearing here: the
// server-only header these interactors carry ends with `imports/client/**.`, and
// a block-comment pass over the raw source reads that trailing `/**` as an
// opening delimiter and swallows everything up to the next JSDoc `*/` - i.e. the
// whole of the file the assertions are about, silently, while still "passing"
// every `not.toMatch`.
function stripComments(source) {
  return source
    .split('\n')
    .map((line) => (/^\s*\/\//.test(line) ? '' : line))
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

const RESOLVE_JS = 'imports/lib/interactors/modules/resolveComponentLicense.js';
const CLEAR_JS = 'imports/lib/interactors/modules/clearComponentLicenseResolution.js';
const MODULE_INDEX_JS = 'imports/lib/interactors/modules/index.js';
const MODULE_STARTUP_JS = 'imports/startup/server/modules.js';
const MODULE_METHODS_JS = 'imports/server/collections/modules.js';
const RISK_JS = 'imports/lib/interactors/riskProperties/reconcileLicenseRisk.js';
const RISK_INDEX_JS = 'imports/lib/interactors/riskProperties/index.js';
const MANAGED_JS = 'imports/lib/interactors/riskProperties/managedFields.js';
const RISK_SCHEMA_JS = 'imports/lib/schemas/riskSchema.js';
const MODULE_SCHEMA_JS = 'imports/lib/schemas/moduleSchema.js';
const PROCESS_SCAN_JS = 'imports/server/scan/processScan.js';
const ROOT_DEP_JS = 'imports/server/scan/rootDependency.js';
const PICK_JS = 'imports/server/scan/componentLicensePick.js';
const CWE_PLAN_JS = 'imports/lib/sarif/cweRiskPlan.js';
const FIXTURES_JS = 'imports/startup/server/fixtures.js';
const LOG_EVENT_JS = 'imports/server/logEvent.js';
const CATCH_ALL_JS = 'imports/lib/licenseResolution/catchAllLicenses.js';

// ---------------------------------------------------------------------------
// Method registration and the alias (Interface Contract)
// ---------------------------------------------------------------------------

describe('the two new methods are registered, once, server-side', () => {
  const live = stripComments(read(MODULE_STARTUP_JS));

  it('registers Modules.ResolveComponentLicense and .ClearComponentLicenseResolution', () => {
    expect(live).toMatch(/'Modules\.ResolveComponentLicense':/);
    expect(live).toMatch(/'Modules\.ClearComponentLicenseResolution':/);
  });

  it('forwards exactly the declared arguments, spelled out rather than ...args', () => {
    // A further argument from a DDP client is where companyId and the acting
    // user would get injected; both are derived server-side from the session.
    expect(live).toMatch(
      /'Modules\.ResolveComponentLicense':\s*async function \(moduleId, componentKey, license, justification\)/);
    expect(live).toMatch(
      /'Modules\.ClearComponentLicenseResolution':\s*async function \(moduleId, componentKey\)/);
    expect(live).not.toMatch(/ResolveComponentLicense[\s\S]{0,80}\.\.\.args/);
  });

  it('imports the interactors from imports/lib/interactors/modules', () => {
    expect(live).toMatch(/ModulesResolveComponentLicense/);
    expect(live).toMatch(/ModulesClearComponentLicenseResolution/);
    expect(stripComments(read(MODULE_INDEX_JS)))
      .toMatch(/export \{default as ModulesResolveComponentLicense\} from '\.\/resolveComponentLicense'/);
    expect(stripComments(read(MODULE_INDEX_JS)))
      .toMatch(/export \{default as ModulesClearComponentLicenseResolution\} from '\.\/clearComponentLicenseResolution'/);
  });
});

describe('PropagateLicensePicks keeps the old method name as an alias', () => {
  const live = stripComments(read(MODULE_METHODS_JS));

  it('registers the new name', () => {
    expect(live).toMatch(/'Modules\.PropagateLicensePicks':/);
  });

  it('keeps Modules.PropagateRootLicense registered, pointing at the SAME handler', () => {
    // A DDP method call outstanding across a deploy is re-sent on reconnect.
    // Dropping the old name would fail that retry outright.
    expect(live).toMatch(/'Modules\.PropagateRootLicense':/);
    const handler = live.match(/'Modules\.PropagateLicensePicks':\s*([A-Za-z0-9_]+),/);
    expect(handler).not.toBeNull();
    expect(live).toMatch(
      new RegExp("'Modules\\.PropagateRootLicense':\\s*" + handler[1] + "\\s*,"));
  });

  it('applies the resolved component licenses BEFORE the root license', () => {
    // Ordering is the contract: applyRootLicense owns the root node from the
    // same storage slot, so it has to run last and win there.
    const resolvedAt = live.indexOf('applyResolvedLicenses(scan, module, company, user)');
    const rootAt = live.indexOf('applyRootLicense(scan, module, company, user)');
    expect(resolvedAt).toBeGreaterThan(-1);
    expect(rootAt).toBeGreaterThan(resolvedAt);
  });
});

// ---------------------------------------------------------------------------
// The gate chain (AC5, AC6, AC15)
// ---------------------------------------------------------------------------

describe('resolveComponentLicense - the gate chain', () => {
  const raw = read(RESOLVE_JS);
  const live = stripComments(raw);

  it('is marked server-only by contract', () => {
    expect(raw).toMatch(/SERVER-ONLY BY CONTRACT/);
  });

  it('validates the arguments BEFORE it touches the session or the database', () => {
    const validateAt = live.indexOf('validateResolutionInput(');
    const userAt = live.indexOf('Meteor.userAsync()');
    const findAt = live.indexOf('Modules.findOneAsync(');
    expect(validateAt).toBeGreaterThan(-1);
    expect(userAt).toBeGreaterThan(validateAt);
    expect(findAt).toBeGreaterThan(userAt);
  });

  it('reuses the shared validator rather than re-deriving the bounds', () => {
    expect(live).toMatch(/from '\/imports\/lib\/licenseResolution\/resolutionEntry'/);
    expect(live).not.toMatch(/function validateResolutionInput/);
    expect(live).not.toMatch(/length > 2000/);
  });

  it('derives companyId from the session and never from an argument (AC6)', () => {
    expect(live).toMatch(/const companyId = user && user\.profile && user\.profile\.companyId;/);
    expect(live).not.toMatch(/function \([^)]*companyId/);
  });

  it('requires BOTH compliance_manager and manager to be accepted roles (AC5)', () => {
    expect(live).toMatch(/\['compliance_manager', 'manager'\]/);
    // The bug the designer found in add_legal_rule_resolved: its template admits
    // both roles while its handler checks 'manager' only, so a compliance manager
    // silently hits "not allowed". Do not copy it.
    expect(live).not.toMatch(/userIsInRole\(user, 'manager'/);
  });

  it('scopes the module lookup by companyId (AC6)', () => {
    expect(live).toMatch(/Modules\.findOneAsync\(\{_id: moduleId, companyId\}/);
    expect(live).not.toMatch(/Modules\.findOneAsync\(moduleId/);
  });

  it('answers every gate failure with 403 Access Denied and nothing else', () => {
    const throws = live.match(/throw new Meteor\.Error\((\d+), ([^)]*)\)/g) || [];
    expect(throws.length).toBeGreaterThan(0);
    throws.forEach((t) => expect(t).toMatch(/Meteor\.Error\((400|403), /));
    expect(live).toMatch(/const AD = 'Access Denied';/);
    expect(live).toMatch(/throw new Meteor\.Error\(403, AD\)/);
  });

  it('never echoes the caller\'s justification back in an error or a log message', () => {
    // Fixed literals only. `reason` reaches the browser, and Company Logs is
    // exported to CSV with `quotes: false`.
    expect(live).not.toMatch(/Meteor\.Error\([^)]*justification/);
    expect(live).not.toMatch(/logEvent[\s\S]{0,200}\bjustification\b/);
  });

  it('runs every gate BEFORE the first write (AC6 - nothing written anywhere)', () => {
    const roleAt = live.indexOf('userIsInRole');
    const moduleAt = live.indexOf('Modules.findOneAsync(');
    const writeAt = live.indexOf('Modules.updateAsync(');
    expect(writeAt).toBeGreaterThan(roleAt);
    expect(writeAt).toBeGreaterThan(moduleAt);
  });
});

describe('resolveComponentLicense - the atomic write (issue #121)', () => {
  const live = stripComments(read(RESOLVE_JS));

  it('never reads the array, edits it and writes it back', () => {
    // Read-modify-write of licensesSelected is what turns a DDP reconnect retry
    // and two concurrent calls into two entries for one component key.
    expect(live).not.toMatch(/licensesSelected\.push\(/);
    expect(live).not.toMatch(/\$set: \{'componentConfig\.licensesSelected': /);
  });

  it('uses the positional $set first, then a CONDITIONAL $push', () => {
    expect(live).toMatch(
      /'componentConfig\.licensesSelected\.key': componentKey\}[\s\S]{0,120}\$set:[\s\S]{0,80}'componentConfig\.licensesSelected\.\$': entry/);
    expect(live).toMatch(
      /'componentConfig\.licensesSelected\.key': \{\$ne: componentKey\}\}[\s\S]{0,120}\$push/);
  });

  it('marks the module for re-analysis', () => {
    expect(live).toMatch(/\$set: \{analysisRequired: true\}/);
  });

  it('returns without writing when nothing changed (AC22)', () => {
    const guardAt = live.indexOf('isResolutionUnchanged(');
    const writeAt = live.indexOf('Modules.updateAsync(');
    expect(guardAt).toBeGreaterThan(-1);
    expect(writeAt).toBeGreaterThan(guardAt);
    expect(live).toMatch(/return \{ok: true, changed: false, risk: 'unchanged'\}/);
  });

  it('writes exactly one logEvent per resolution (AC11)', () => {
    const logs = live.match(/'componentLicenseResolved'/g) || [];
    expect(logs.length).toBe(1);
    // ...and the unchanged branch returns before reaching it.
    const unchangedAt = live.indexOf("risk: 'unchanged'");
    const logAt = live.indexOf("'componentLicenseResolved'");
    expect(logAt).toBeGreaterThan(unchangedAt);
  });

  it('files the risk AFTER the module write, and never lets it fail the resolve (AC25)', () => {
    const writeAt = live.indexOf('Modules.updateAsync(');
    const riskAt = live.indexOf('reconcileLicenseRisk(');
    expect(riskAt).toBeGreaterThan(writeAt);
    expect(live).toMatch(/return \{ok: true, changed: true, risk\}/);
  });
});

describe('clearComponentLicenseResolution - undo (AC18, AC19)', () => {
  const raw = read(CLEAR_JS);
  const live = stripComments(raw);

  it('is marked server-only by contract', () => {
    expect(raw).toMatch(/SERVER-ONLY BY CONTRACT/);
  });

  it('runs the same gate chain', () => {
    expect(live).toMatch(/\['compliance_manager', 'manager'\]/);
    expect(live).toMatch(/Modules\.findOneAsync\(\{_id: moduleId, companyId\}/);
    expect(live).toMatch(/const AD = 'Access Denied';/);
    expect(live).toMatch(/throw new Meteor\.Error\(403, AD\)/);
  });

  it('pulls ONLY an entry that carries a justification', () => {
    // Otherwise undo would delete a multi-license-modal pick or a root-picker
    // pick that this feature never wrote.
    expect(live).toMatch(/findResolution\(/);
    expect(live).toMatch(/\$pull:/);
    // ...and "carries a justification" means what hasJustification means: a
    // non-empty trimmed STRING. $exists: true also matched null and '', which
    // every JS discriminator in this feature refuses.
    expect(live).toMatch(/justification: OURS/);
    expect(live).toMatch(/const OURS = \{\$type: 'string', \$regex: \/\\S\/\};/);
  });

  it('NEVER touches the risk register (AC19)', () => {
    expect(live).not.toMatch(/RiskProperties/);
    expect(live).not.toMatch(/reconcileLicenseRisk/);
  });

  it('writes its own logEvent, exactly once', () => {
    const logs = live.match(/'componentLicenseResolutionCleared'/g) || [];
    expect(logs.length).toBe(1);
  });

  it('returns the documented shape', () => {
    expect(live).toMatch(/return \{ok: true, changed: false\}/);
    expect(live).toMatch(/return \{ok: true, changed: /);
  });
});

// ---------------------------------------------------------------------------
// The risk upsert (AC20-AC26)
// ---------------------------------------------------------------------------

describe('reconcileLicenseRisk', () => {
  const raw = read(RISK_JS);
  const live = stripComments(raw);

  it('is marked server-only by contract, like reconcileFromSarif', () => {
    expect(raw).toMatch(/SERVER-ONLY BY CONTRACT/);
  });

  it('gates on module-in-company, then projectId, with no feature licence check (AC23)', () => {
    // The Community Edition has one tier: every company has every feature, so
    // the former `indexOf('risks')` licence check is gone.
    const moduleAt = live.indexOf('companyId');
    const projectAt = live.indexOf('module.projectId');
    expect(moduleAt).toBeGreaterThan(-1);
    expect(projectAt).toBeGreaterThan(-1);
    expect(live).not.toMatch(/indexOf\('risks'\)/);
    expect(live).not.toMatch(/allowedLicenses/);
  });

  it('inserts with origin LIC and the autoLicense denormalization (AC26)', () => {
    // The origin comes from the planner constant, not a second literal - the
    // canonical list is riskOrigin.js and license-risk-plan.unit.spec.js pins the
    // constant to 'LIC' against it.
    expect(live).toMatch(/origin: \[LICENSE_RISK_ORIGIN\]/);
    expect(live).toMatch(/autoKey/);
    expect(live).toMatch(/autoLicense: /);
    expect(live).toMatch(/state: 'identified'/);
    const {LICENSE_RISK_ORIGIN} =
      require('../../imports/lib/licenseResolution/licenseRiskPlan');
    expect(LICENSE_RISK_ORIGIN).toBe('LIC');
  });

  it('treats a duplicate key as the update it really is (AC22)', () => {
    expect(live).toMatch(/11000/);
  });

  it('respects the states a human has already dealt with', () => {
    expect(live).toMatch(/UNTOUCHED_RISK_STATES/);
    expect(live).toMatch(/from '\.\/managedFields'/);
  });

  it('never rewrites state, origin, userId or userName on update (AC24)', () => {
    const updateAt = live.indexOf('RiskProperties.updateAsync(');
    expect(updateAt).toBeGreaterThan(-1);
    const modifier = live.slice(live.lastIndexOf('$set', updateAt) - 200, updateAt + 200);
    expect(modifier).not.toMatch(/'riskProperties\.state'/);
    expect(modifier).not.toMatch(/'riskProperties\.origin'/);
    expect(modifier).not.toMatch(/userName:/);
  });

  it('does not write at all when the stored license is already the one picked', () => {
    expect(live).toMatch(/return 'unchanged'/);
    const unchangedAt = live.indexOf("return 'unchanged'");
    const updateAt = live.indexOf('RiskProperties.updateAsync(');
    expect(updateAt).toBeGreaterThan(unchangedAt);
  });

  it('catches its own failure and answers "skipped" (AC25)', () => {
    expect(live).toMatch(/catch \(/);
    expect(live).toMatch(/return 'skipped'/);
    expect(live).toMatch(/console\.error\(/);
  });

  it('creates no new index - the existing compound unique one covers it', () => {
    expect(live).not.toMatch(/createIndex/);
    expect(stripComments(read('imports/server/collections/riskProperties.js')))
      .toMatch(/riskProperties_company_autoKey_unique/);
  });

  it('is exported through the riskProperties interactor index', () => {
    expect(stripComments(read(RISK_INDEX_JS)))
      .toMatch(/export \{default as RiskPropertiesReconcileLicenseRisk\} from '\.\/reconcileLicenseRisk'/);
  });
});

describe('autoLicense is a server-managed field', () => {
  it('is declared on the schema with the license bound', () => {
    const live = stripComments(read(RISK_SCHEMA_JS));
    expect(live).toMatch(/autoLicense:\s*\{[\s\S]{0,120}max: 100/);
  });

  it('is stripped from every client-supplied modifier', () => {
    // Without this a client forges or clears it through RiskProperties.Update and
    // the next resolution mints a duplicate. `denyUpdate` is a NO-OP here.
    const {MANAGED_RISK_PROPERTY_KEYS, MANAGED_RISK_FIELDS} =
      require('../../imports/lib/interactors/riskProperties/managedFields');
    expect(MANAGED_RISK_PROPERTY_KEYS).toContain('autoLicense');
    expect(MANAGED_RISK_FIELDS).toContain('riskProperties.autoLicense');
    expect(stripComments(read(MANAGED_JS))).toMatch(/'autoLicense'/);
  });
});

// ---------------------------------------------------------------------------
// The injection and its ordering against the component write path (AC16, AC17)
// ---------------------------------------------------------------------------

describe('processScan applies the resolved licenses in the right place', () => {
  const live = stripComments(read(PROCESS_SCAN_JS));

  it('exports applyResolvedLicenses so PropagateLicensePicks can share it', () => {
    expect(live).toMatch(/export async function applyResolvedLicenses\(scan, module, company, user\)/);
  });

  it('runs it AFTER the dependency loop and BEFORE applyRootLicense', () => {
    // After the loop: component documents are written first, so the pick is never
    // read as a declared license by this run. Before applyRootLicense: the root
    // node belongs to that function.
    const loopAt = live.indexOf('for (const dependency of scan.dependencies || [])');
    const resolvedAt = live.indexOf('await applyResolvedLicenses(scan, module, company, user)');
    const rootAt = live.indexOf('await applyRootLicense(scan, module, company, user)');
    expect(loopAt).toBeGreaterThan(-1);
    expect(resolvedAt).toBeGreaterThan(loopAt);
    expect(rootAt).toBeGreaterThan(resolvedAt);
  });

  it('hands the walk the root key it must not touch', () => {
    expect(live).toMatch(/findRootDependency\(scan\)[\s\S]{0,80}\|\| \{\}\)\.key/);
    expect(live).toMatch(/injectResolvedLicenses\(scan, map, rootKey\)/);
  });

  it('does not let a resolution failure abandon the scan', () => {
    const at = live.indexOf('await applyResolvedLicenses(scan, module, company, user)');
    const before = live.slice(Math.max(0, at - 200), at);
    expect(before).toMatch(/try \{/);
  });

  it('leaves the component write path exactly as it was', () => {
    // AC17 is bought by widening the marker predicate, not by touching these.
    const matches = live.match(/withoutRootPickLicenses\(dependency\.licenses\)/g) || [];
    expect(matches.length).toBe(2);
    expect(live).toMatch(/if \(isRootPickLicense\(license\)\)/);
  });
});

describe('the marker predicate covers BOTH injection origins (AC17)', () => {
  const live = stripComments(read(ROOT_DEP_JS));

  it('keeps ROOT_LICENSE_ORIGIN at its exact stored value', () => {
    // Scans persisted before this change carry it; changing it would orphan them.
    expect(live).toMatch(/const ROOT_LICENSE_ORIGIN = 'ts-root-pick';/);
    expect(live).toMatch(/const COMPONENT_LICENSE_ORIGIN = 'ts-component-pick';/);
  });

  it('exports the old names unchanged AND the new aliases', () => {
    ['ROOT_LICENSE_ORIGIN', 'rootPickLicense', 'isRootPickLicense', 'withoutRootPickLicenses',
      'COMPONENT_LICENSE_ORIGIN', 'componentPickLicense', 'isInjectedLicense',
      'withoutInjectedLicenses'].forEach((name) => {
      expect(live).toMatch(new RegExp('module\\.exports[\\s\\S]*\\b' + name + '\\b'));
    });
  });

  it('has one predicate, not two that can drift apart', () => {
    expect(live).not.toMatch(/function isComponentPickLicense/);
    expect(live).toMatch(/const isRootPickLicense = isInjectedLicense/);
  });
});

// ---------------------------------------------------------------------------
// The catalogue seed (AC8)
// ---------------------------------------------------------------------------

describe('the catalogue seed is an insert-if-missing that never modifies a license', () => {
  const live = stripComments(read(FIXTURES_JS));

  it('reads the key list from the shared module rather than forking it', () => {
    expect(live).toMatch(/from '\/imports\/lib\/licenseResolution\/catchAllLicenses'/);
    expect(live).toMatch(/CATCH_ALL_LICENSE_SEEDS/);
  });

  it('inserts a catch-all entry only when its key is missing', () => {
    const start = live.indexOf('async function ensureCatalogueLicense');
    expect(start).toBeGreaterThan(-1);
    const fn = live.slice(start, live.indexOf('Meteor.startup(', start));
    expect(fn).toMatch(/Licenses\.findOneAsync\(\{key: spec\.key\}/);
    expect(fn).toMatch(/Licenses\.insertAsync\(/);
    expect(fn).not.toMatch(/Licenses\.updateAsync\(/);
  });

  it('drops the old insert-if-missing NO-LICENSE block', () => {
    // Non-vacuity: two seeds for one key would race and the second would 11000.
    const noLicenseInserts = live.match(/key: 'NO-LICENSE'/g) || [];
    expect(noLicenseInserts.length).toBe(0);
  });

  it('re-primes the LicensesService cache once the seed has run', () => {
    const seedAt = live.indexOf('ensureCatalogueLicense(');
    const initAt = live.indexOf('LicensesService.init()');
    expect(initAt).toBeGreaterThan(seedAt);
    expect(live).toMatch(/await LicensesService\.init\(\)/);
  });

  it('seeds the popular licenses through the planner, before the cache refresh', () => {
    expect(live).toMatch(/licensesToSeed\(POPULAR_LICENSES\.licenses, existingKeys\)/);
    expect(live).not.toMatch(/sampleLicenses/);
    expect(live.indexOf('licensesToSeed(POPULAR_LICENSES')).toBeLessThan(live.indexOf('await LicensesService.init()'));
  });
});

// ---------------------------------------------------------------------------
// Audit trail and bundle hygiene
// ---------------------------------------------------------------------------

describe('the new log-event types are registered', () => {
  const live = stripComments(read(LOG_EVENT_JS));

  it('registers every key this feature emits, so Company Logs shows a TYPE', () => {
    ['componentLicenseResolved', 'componentLicenseResolutionCleared',
      'licenseRiskCreated', 'licenseRiskUpdated', 'componentLicensesApplied']
      .forEach((key) => expect(live).toMatch(new RegExp("key: ?'" + key + "'")));
  });
});

describe('the server-only interactors never reach the browser bundle', () => {
  // The three files that import Modules / Companies / RiskProperties and call
  // Meteor.userAsync(). They are reached ONLY through the two server-side
  // interactor barrels (and, for the risk one, from the resolve interactor that
  // owns it) - exactly the arrangement reconcileFromSarif.js already has.
  const ALLOWED_IMPORTERS = [MODULE_INDEX_JS, RISK_INDEX_JS, RESOLVE_JS];

  function importersOf(targets, roots) {
    const found = [];
    function walk(dir) {
      const abs = path.join(REPO, dir);
      if (!fs.existsSync(abs)) return;
      fs.readdirSync(abs, {withFileTypes: true}).forEach((entry) => {
        const rel = dir + '/' + entry.name;
        if (entry.isDirectory()) return walk(rel);
        if (!/\.js$/.test(entry.name)) return;
        const src = stripComments(read(rel));
        targets.forEach((t) => {
          if (new RegExp("from '[^']*" + t + "'|require\\('[^']*" + t + "'\\)").test(src) &&
              found.indexOf(rel) === -1) {
            found.push(rel);
          }
        });
      });
    }
    roots.forEach(walk);
    return found;
  }

  const TARGETS = ['resolveComponentLicense', 'clearComponentLicenseResolution',
    'reconcileLicenseRisk'];

  it('is named by nothing under imports/client, imports/api or imports/startup/client', () => {
    expect(importersOf(TARGETS,
      ['imports/client', 'imports/api', 'imports/startup/client'])).toEqual([]);
  });

  it('is reached only through the server-side barrels and the interactor that owns it', () => {
    const unexpected = importersOf(TARGETS, ['imports'])
      .filter((rel) => ALLOWED_IMPORTERS.indexOf(rel) === -1);
    expect(unexpected).toEqual([]);
  });

  it('each of the three carries the SERVER-ONLY header', () => {
    [RESOLVE_JS, CLEAR_JS, RISK_JS].forEach((rel) =>
      expect(read(rel)).toMatch(/SERVER-ONLY BY CONTRACT/));
  });

  it('the shared catch-all module is imported read-only by both sides', () => {
    // It exists so the picker and the seed cannot drift. It must therefore stay
    // free of anything server-only.
    const raw = read(CATCH_ALL_JS);
    expect(raw).not.toMatch(/imports\/server\//);
    expect(raw).not.toMatch(/meteor\//);
  });
});

describe('the schema stopped rejecting the entries this app itself writes', () => {
  const live = stripComments(read(MODULE_SCHEMA_JS));
  const block = live.slice(live.indexOf('const SelectedLicensesEntrySchema'),
    live.indexOf('const ModuleComponentConfig'));

  it('makes `version` optional - all three shipped writers omit it', () => {
    // Whole-class fix: each of them would 400 a REST module PUT today, because
    // apiSchema clean()s componentConfig when the caller supplies it.
    expect(block).toMatch(/version: \{[\s\S]{0,160}optional: true/);
  });

  it('declares the four audit fields, all optional', () => {
    ['justification', 'resolvedBy', 'resolvedById', 'resolvedAt'].forEach((field) => {
      expect(block).toMatch(new RegExp(field + ': \\{[\\s\\S]{0,200}optional: true'));
    });
  });

  it('bounds the justification at the same 2000 the method enforces', () => {
    const {JUSTIFICATION_MAX} =
      require('../../imports/lib/licenseResolution/resolutionEntry');
    expect(block).toMatch(new RegExp('max: ' + JUSTIFICATION_MAX));
  });
});

describe('cweRiskPlan exports the escape and the bound instead of hiding them', () => {
  it('adds escapeKeySegment to its exports, additively', () => {
    const live = stripComments(read(CWE_PLAN_JS));
    expect(live).toMatch(/module\.exports[\s\S]*escapeKeySegment/);
    expect(live).toMatch(/module\.exports[\s\S]*AUTO_KEY_MAX/);
  });
});
