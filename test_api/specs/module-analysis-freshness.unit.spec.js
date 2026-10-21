/* eslint-disable no-undef */
// Stale analysis on the module pages.
//
// `getModuleData` in imports/lib/router.js resolves the analysis a module page
// renders through `ReactiveMethod.call('findOneModuleAnalysis', filter, options)`.
// ReactiveMethod caches one result per (method, arguments) for the lifetime of
// the computation. The filter was `{companyId, moduleId}` and the options
// `{sort: {date: -1}}` - neither ever changed while the route stayed put - so the
// analysis fetched on first render was handed straight back on every rerun. A
// re-analysis (a versioning or viability settings change, a fresh scan) stayed
// invisible until the page was reloaded by hand.
//
// The fix keys the lookup on the id of the analysis the module currently owns, so
// the cache key moves when a new analysis is written. WHICH FIELD carries that id
// is the whole ballgame, and the first attempt got it wrong:
//
//   * top-level `module.analysisId` was written by exactly one place in this repo, a
//     development-only branch of analyzeModule that is gone now. The analyzer
//     (workers/analysis) never writes it: `ModuleAnalyzer.saveResult`
//     builds `$set: {status, analysisRequired, analyzed, statistics}` and puts the
//     id on `statistics.analysisId`. Keying on the top-level field therefore fixed
//     nothing outside a developer's laptop.
//   * `statistics.analysisId` is the field the analyzer maintains, in every
//     environment, and it moves on every analysis.
//
// The id is a PREFERENCE, not a selector: `findOneModuleAnalysis` applies it on top
// of the caller's company/module filter and falls back to the newest-by-date lookup
// when it resolves to nothing, so a deleted analysis cannot leave the page rendering
// as if the module had never been analysed. The fallback query only runs in that
// stale case - an unconditional second call would fetch a potentially large analysis
// document twice on every module page load.
//
// Because the pointer tolerates dangling, nothing has to rewrite it on delete -
// which matters, since `statistics.analysisId` labels the statistics blob it ships
// with and repointing it at another analysis would mislabel those numbers.
//
// WHY source pattern matching (same rationale as the sibling *.unit specs in this
// dir): router.js and the server collection files import meteor/* and cannot be
// loaded under jest, and no live DDP/Minimongo harness is wired into it.
const fs = require('fs');
const path = require('path');
const _ = require('underscore');

const REPO = path.join(__dirname, '..', '..');

function raw(rel) {
  return fs.readFileSync(path.join(REPO, rel), 'utf8');
}

// Comment-aware: every hunk of this change ships with a long explanatory comment
// that names the identifiers under assertion, so a match against the raw file
// would false-pass on prose alone.
function code(rel) {
  return raw(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const ROUTER = 'imports/lib/router.js';
const ANALYSIS = 'imports/server/collections/analysis.js';
const MODULES_SERVER = 'imports/server/collections/modules.js';
const MODULES_COLLECTION = 'imports/lib/collections/modules.js';
const MODULE_SCHEMA = 'imports/lib/schemas/moduleSchema.js';
const MODULE_MODEL = 'imports/lib/project/Module.js';

// getModuleData() only - router.js is ~3200 lines and mentions `analysis`
// everywhere else.
function getModuleData() {
  const src = code(ROUTER);
  const start = src.indexOf('function getModuleData(route)');
  expect(start).toBeGreaterThan(-1);
  const end = src.indexOf('\n}', src.indexOf('return module;', start));
  return src.slice(start, end);
}

// A named method body out of imports/server/collections/analysis.js.
function analysisMethod(name, nextName) {
  const src = code(ANALYSIS);
  const start = src.indexOf(name + ': async function');
  expect(start).toBeGreaterThan(-1);
  const end = src.indexOf(nextName + ':', start);
  expect(end).toBeGreaterThan(start);
  return src.slice(start, end);
}

// ---------------------------------------------------------------------------
// findOneModuleAnalysis, lifted out of the shipped file and actually CALLED.
//
// analysis.js imports meteor/* and cannot be required under jest, but the method
// body itself only reaches for ModuleAnalysis, Utils, underscore and the two
// sanitizeQuery helpers - all of which can be handed in. So the precedence rules
// asserted below are observed outcomes of the shipped source, not regex matches
// that a comment could satisfy.
// ---------------------------------------------------------------------------
const SANITIZE = 'imports/lib/security/sanitizeQuery.js';

// The real guards, not stand-ins: `asString` is what rejects a non-string
// preference and `stripDangerousOperators` is what cleans the filter.
const sanitizeQuery = new Function(
  `${raw(SANITIZE).replace(/^export default .*$/gm, '').replace(/^export /gm, '')}
   return {stripDangerousOperators, asString};`)();

function liftFindOneModuleAnalysis(collection, companyIdForUser) {
  const chunk = analysisMethod('findOneModuleAnalysis', 'getAnalysis');
  const fnExpr = chunk
    .slice('findOneModuleAnalysis: async function'.length)
    .trim()
    .replace(/,$/, '')
    .trim();
  // If the method ever changes signature this must be re-anchored, never relaxed.
  expect(fnExpr.startsWith('(filter, params, preferredId)')).toBe(true);
  expect(fnExpr.endsWith('}')).toBe(true);
  const factory = new Function(
    'ModuleAnalysis', 'Utils', 'stripDangerousOperators', 'asString', '_',
    `return async function ${fnExpr};`);
  return factory(
    collection,
    {getCompanyIdForUserAsync: async () => companyIdForUser},
    sanitizeQuery.stripDangerousOperators,
    sanitizeQuery.asString,
    _);
}

// Minimal ModuleAnalysis stand-in that records every query it is asked to run.
function analysisStore(docs) {
  const calls = [];
  return {
    calls,
    findOneAsync: async function (selector, params) {
      calls.push({selector: Object.assign({}, selector), params});
      let hits = docs.filter(doc => Object.keys(selector).every(k => doc[k] === selector[k]));
      if (params && params.sort && params.sort.date === -1) {
        hits = hits.slice().sort((a, b) => b.date - a.date);
      }
      return hits[0];
    }
  };
}

describe('the module page re-fetches its analysis when the module repoints', () => {
  it('keys the cached lookup on the field the ANALYZER maintains', () => {
    const fn = getModuleData();
    expect(fn).toMatch(/module\.statistics && module\.statistics\.analysisId/);
  });

  it('does not key it on the dev-only top-level field', () => {
    // Non-vacuity for the assertion above, and the actual defect: this is what the
    // first attempt used, and nothing writes it.
    const fn = getModuleData();
    expect(fn).not.toMatch(/filter\._id = module\.analysisId/);
    expect(fn).not.toMatch(/module\.analysisId/);
  });

  it('hands the id to the cached call, so the cache key moves with it', () => {
    // The point of the whole change. Passed as the call's own argument rather than
    // written into `filter`, because it must be a preference the server may fall
    // back from - a filter is a hard selector.
    const fn = getModuleData();
    expect(fn).toMatch(
      /ReactiveMethod\.call\('findOneModuleAnalysis', filter, options, preferredId\)/);
  });

  it('computes the id BEFORE the cached call, not after it', () => {
    // Assigned after the ReactiveMethod.call the change would be a no-op, and
    // nothing else in the file would notice.
    const fn = getModuleData();
    const assignAt = fn.indexOf('let preferredId');
    const callAt = fn.indexOf("ReactiveMethod.call('findOneModuleAnalysis'");
    expect(assignAt).toBeGreaterThan(-1);
    expect(callAt).toBeGreaterThan(-1);
    expect(assignAt).toBeLessThan(callAt);
  });

  it('lets an explicit ?analysis= query win over the pointer', () => {
    // The approve/release views deep-link a specific historic analysis; pinning
    // them to the module's current one would show the wrong document, and letting
    // the server fall back off it would silently show a different one again.
    const fn = getModuleData();
    expect(fn).toMatch(/let preferredId = analysis \? null :/);
    // Both directions: the query branch that hard-selects it is still there.
    expect(fn).toMatch(/if\s*\(\s*analysis\s*\)\s*\{\s*filter\._id = analysis/);
  });

  it('falls back to newest-by-date for a module with no pointer yet', () => {
    // Non-vacuity for the guard above: modules analysed before the pointer
    // existed must still resolve, so the sort must not have been dropped.
    const fn = getModuleData();
    expect(fn).toMatch(/sort:\s*\{'date':\s*-1\}/);
  });

  it('still scopes the lookup to the module and its company', () => {
    const fn = getModuleData();
    expect(fn).toMatch(/companyId:\s*module\.companyId/);
    expect(fn).toMatch(/moduleId:\s*module\._id/);
  });
});

describe('the server treats the id as a preference and never comes back empty', () => {
  it('tries the preferred analysis first', () => {
    const fn = analysisMethod('findOneModuleAnalysis', 'getAnalysis');
    expect(fn).toMatch(/const preferred = asString\(preferredId\)/);
    expect(fn).toMatch(/_id: preferred/);
  });

  it('rejects a non-string preference outright', () => {
    // It arrives from a DDP client. Reaching a selector unvalidated it could
    // become an operator expression.
    const fn = analysisMethod('findOneModuleAnalysis', 'getAnalysis');
    expect(fn).toMatch(/asString\(preferredId\)/);
    expect(fn).toMatch(/if \(preferred\)/);
  });

  it('applies it ON TOP of the caller\'s filter, never instead of it', () => {
    // The filter carries the company pin; replacing it with a bare {_id} would
    // hand any analysis in the database to any caller who guessed an id.
    const fn = analysisMethod('findOneModuleAnalysis', 'getAnalysis');
    expect(fn).toMatch(/_\.extend\(\{\}, filter, \{_id: preferred\}\)/);
    // The company is resolved from the session and pinned onto the filter before
    // the preferred id is applied; a caller with no company is refused, not
    // served an unscoped query.
    const pinAt = fn.indexOf('filter.companyId = companyId');
    const resolveAt = fn.indexOf('await Utils.getCompanyIdForUserAsync');
    const preferredAt = fn.indexOf('const preferred = asString(preferredId)');
    expect(resolveAt).toBeGreaterThan(-1);
    expect(pinAt).toBeGreaterThan(resolveAt);
    expect(fn).toMatch(/if \(!companyId\) \{\s*\n\s*throw new Meteor\.Error\(403/);
    expect(preferredAt).toBeGreaterThan(pinAt);
  });

  it('falls back to the sorted lookup when the preference resolves to nothing', () => {
    // A deleted analysis must not leave the page with no analysis at all.
    const fn = analysisMethod('findOneModuleAnalysis', 'getAnalysis');
    expect(fn).toMatch(/if \(found\) \{\s*\n\s*return found;/);
    expect(fn).toMatch(/return await ModuleAnalysis\.findOneAsync\(filter, params\);/);
  });

  it('pays for the second query only when the preference is stale', () => {
    // Both queries are inside the method, and the fallback sits behind the
    // `if (found) return` above - so the common path is a single findOne, not two
    // fetches of a potentially multi-MB analysis document per page load.
    const fn = analysisMethod('findOneModuleAnalysis', 'getAnalysis');
    const lookups = fn.match(/ModuleAnalysis\.findOneAsync\(/g) || [];
    expect(lookups.length).toBe(2);
    const foundAt = fn.indexOf('if (found)');
    const fallbackAt = fn.indexOf('return await ModuleAnalysis.findOneAsync(filter, params)');
    expect(foundAt).toBeGreaterThan(-1);
    expect(fallbackAt).toBeGreaterThan(foundAt);
  });
});

describe('an explicitly pinned filter._id outranks the preference', () => {
  // `_.extend({}, filter, {_id: preferred})` merges the preference LAST, so a
  // caller that supplies BOTH a pinned `_id` (the ?analysis= deep link) and a
  // preferredId had its pin silently swapped for the module's current analysis.
  // router.js never sends both - it passes `analysis ? null : ...` - but any DDP
  // client can, and the pin is documented and tested as a hard selector.
  const DOCS = [
    {_id: 'pinned', companyId: 'co', moduleId: 'mod', date: 1},
    {_id: 'current', companyId: 'co', moduleId: 'mod', date: 9}
  ];
  const OPTIONS = {sort: {date: -1}};

  function subject() {
    const store = analysisStore(DOCS);
    return {store, findOne: liftFindOneModuleAnalysis(store, 'co')};
  }

  it('returns the pinned analysis, not the module pointer', async () => {
    const {store, findOne} = subject();
    const found = await findOne.call(
      {userId: 'user-of-co'}, {moduleId: 'mod', _id: 'pinned'}, OPTIONS, 'current');
    expect(found).toBeDefined();
    expect(found._id).toBe('pinned');
    expect(store.calls[0].selector._id).toBe('pinned');
  });

  it('issues no second query for the preference it skipped', async () => {
    const {store, findOne} = subject();
    await findOne.call(
      {userId: 'user-of-co'}, {moduleId: 'mod', _id: 'pinned'}, OPTIONS, 'current');
    expect(store.calls.length).toBe(1);
  });

  it('still pins the DDP caller to their own company', async () => {
    // The pin short-circuit must not skip past the tenant overwrite above it.
    const {store, findOne} = subject();
    const found = await findOne.call(
      {userId: 'user-of-co'},
      {moduleId: 'mod', _id: 'pinned', companyId: 'someone-elses-company'},
      OPTIONS,
      'current');
    expect(store.calls[0].selector.companyId).toBe('co');
    expect(found._id).toBe('pinned');
  });

  it('honours the pin even when it matches nothing at all', async () => {
    // A pin is a selector: an unknown id yields nothing, rather than quietly
    // falling through to some other module's newest analysis.
    const {store, findOne} = subject();
    const found = await findOne.call(
      {userId: 'user-of-co'}, {moduleId: 'mod', _id: 'no-such-analysis'}, OPTIONS, 'current');
    expect(found).toBeUndefined();
    expect(store.calls.length).toBe(1);
  });

  it('non-vacuity: without a pin the preference still beats newest-by-date', async () => {
    // `pinned` is the OLDEST document, so a preference that was silently dropped
    // by an over-eager guard would surface as `current` here.
    const {store, findOne} = subject();
    const found = await findOne.call(
      {userId: 'user-of-co'}, {moduleId: 'mod'}, OPTIONS, 'pinned');
    expect(found._id).toBe('pinned');
    expect(store.calls.length).toBe(1);
  });

  it('non-vacuity: a dangling preference still falls back to the sorted lookup', async () => {
    const {store, findOne} = subject();
    const found = await findOne.call(
      {userId: 'user-of-co'}, {moduleId: 'mod'}, OPTIONS, 'deleted-long-ago');
    expect(found._id).toBe('current');
    expect(store.calls.length).toBe(2);
  });

  it('leaves the two-argument REST caller on its single sorted lookup', async () => {
    // imports/server/rest-api/modules.js passes no preferredId and no userId, and
    // its server-built companyId must survive untouched.
    const {store, findOne} = subject();
    const found = await findOne.call({}, {companyId: 'co', moduleId: 'mod'}, OPTIONS);
    expect(found._id).toBe('current');
    expect(store.calls.length).toBe(1);
    expect(store.calls[0].selector.companyId).toBe('co');
  });

  it('checks the pin before it resolves the preference', () => {
    const fn = analysisMethod('findOneModuleAnalysis', 'getAnalysis');
    const pinAt = fn.indexOf('filter._id');
    const preferredAt = fn.indexOf('const preferred = asString(preferredId)');
    expect(pinAt).toBeGreaterThan(-1);
    expect(preferredAt).toBeGreaterThan(pinAt);
  });
});

describe('precondition: the pointer is readable on the client', () => {
  it('the moduleById publication does not project statistics away', () => {
    const src = code(MODULES_SERVER);
    const at = src.indexOf("Meteor.publish('moduleById'");
    expect(at).toBeGreaterThan(-1);
    const body = src.slice(at, src.indexOf('Meteor.publish', at + 10));
    // The projection is exclusion-only (`{analysis: 0}`). An inclusion
    // projection, or an explicit exclusion of statistics, would make
    // module.statistics undefined on the client and silently disable the fix.
    const fields = body.match(/let fields = \{([^}]*)\}/);
    expect(fields).not.toBeNull();
    expect(fields[1]).not.toMatch(/statistics/);
    const inclusions = fields[1].match(/:\s*1\b/g) || [];
    expect(inclusions).toEqual([]);
  });

  it('the Module transform copies document fields onto the instance', () => {
    // Modules.find() returns Module instances. Component-style constructors hide
    // the document behind a data() closure - if Module ever did that,
    // `module.statistics` in the router would read undefined.
    expect(code(MODULES_COLLECTION)).toMatch(/return new Module\(doc\)/);
    expect(code(MODULE_MODEL)).toMatch(/_\.extend\(this, docOrCompanyId\)/);
  });

  it('the schema declares analysisId inside statistics, where the analyzer puts it', () => {
    // Nothing is attached to the Modules collection today, but if a schema ever is,
    // collection2 filters out undeclared keys - and `statistics.analysisId` is the
    // one shape that survives that.
    const schema = code(MODULE_SCHEMA);
    expect(schema).toMatch(/'statistics\.analysisId'|statistics\.analysisId|analysisId:/);
    expect(code(MODULES_COLLECTION)).not.toMatch(/attachSchema/);
  });
});

describe('why the top-level field could not carry this', () => {
  it('ts-app never writes module.analysisId', () => {
    // The only writer of the top-level field was the development-only branch of
    // analyzeModule, removed when analysis moved into a worker thread that writes to
    // this database. If a writer is ever added this test should be revisited - but the
    // pointer would still have to agree with statistics.
    expect(code(MODULES_SERVER)).not.toMatch(/analysisId: results\._id/);
  });
});

describe('removeSingleAnalysis validates the id it is handed', () => {
  it('refuses anything but a plain string', () => {
    // Both ModuleAnalysis.findOneAsync and .removeAsync accept an OBJECT as a
    // selector, and the 403 gate only inspects the single document findOne
    // returned. A crafted selector could return one of the caller's own analyses
    // (passing the tenant check) while the remove matched other tenants' documents
    // - cross-tenant mass deletion.
    const fn = analysisMethod('removeSingleAnalysis', 'findOneModuleAnalysis');
    expect(fn).toMatch(/const id = asString\(analysisId\)/);
    expect(fn).toMatch(/throw new Meteor\.Error\(400/);
  });

  it('uses the validated id for BOTH the lookup and the delete', () => {
    // Validating and then still passing the raw argument to removeAsync would
    // leave the hole exactly where it was.
    const fn = analysisMethod('removeSingleAnalysis', 'findOneModuleAnalysis');
    expect(fn).toMatch(/ModuleAnalysis\.findOneAsync\(id\)/);
    expect(fn).toMatch(/ModuleAnalysis\.removeAsync\(id\)/);
    expect(fn).not.toMatch(/ModuleAnalysis\.findOneAsync\(analysisId\)/);
    expect(fn).not.toMatch(/ModuleAnalysis\.removeAsync\(analysisId\)/);
  });

  it('validates before it reads anything', () => {
    const fn = analysisMethod('removeSingleAnalysis', 'findOneModuleAnalysis');
    const validateAt = fn.indexOf('const id = asString(analysisId)');
    const readAt = fn.indexOf('ModuleAnalysis.findOneAsync(id)');
    expect(validateAt).toBeGreaterThan(-1);
    expect(readAt).toBeGreaterThan(validateAt);
  });

  it('still refuses another company\'s analysis', () => {
    const fn = analysisMethod('removeSingleAnalysis', 'findOneModuleAnalysis');
    expect(fn).toMatch(/analysis\.companyId !== companyId/);
    expect(fn).toMatch(/Roles\.userIsInRole\(/);
  });

  it('does not rewrite the module pointer', () => {
    // statistics.analysisId labels the statistics blob it ships with; repointing it
    // at a different analysis while leaving those numbers in place would mislabel
    // them. The dangling pointer is handled by the fallback in
    // findOneModuleAnalysis instead - so this method writes to Modules at all.
    const fn = analysisMethod('removeSingleAnalysis', 'findOneModuleAnalysis');
    expect(fn).not.toMatch(/Modules\.updateAsync/);
    expect(fn).not.toMatch(/\$set:\s*\{analysisId/);
    expect(fn).not.toMatch(/\$unset:\s*\{analysisId/);
  });

  it('leaves the `latest` bookkeeping to the hook that already does it', () => {
    // Both directions: removing the repointing must not have taken the hook with it.
    const src = code(ANALYSIS);
    const at = src.indexOf('ModuleAnalysis.after.remove');
    expect(at).toBeGreaterThan(-1);
    const hook = src.slice(at, src.indexOf('{fetchPrevious: false});', at));
    expect(hook).toMatch(/\$set:\s*\{latest:\s*true\}/);
  });
});

describe('the other analysis-removal paths leave nothing unreachable', () => {
  it('deleteModuleAnalysis wipes the module\'s whole history', () => {
    const src = code(MODULES_SERVER);
    const at = src.indexOf('deleteModuleAnalysis: async function');
    expect(at).toBeGreaterThan(-1);
    const body = src.slice(at, src.indexOf('getModuleComponents:', at));
    expect(body).toMatch(/ModuleAnalysis\.removeAsync\(\{moduleId, companyId\}\)/);
    expect(body).not.toMatch(/latest|date|\$lt|\$ne/);
  });

  it('removing a module takes its analyses with it', () => {
    const src = code(MODULES_SERVER);
    const at = src.indexOf('Modules.after.remove');
    expect(at).toBeGreaterThan(-1);
    const body = src.slice(at, at + 400);
    expect(body).toMatch(/ModuleAnalysis\.removeAsync\(commonSettings\)/);
  });
});
