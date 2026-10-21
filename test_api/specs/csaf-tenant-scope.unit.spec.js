// ---------------------------------------------------------------------------
// The CSAF product_id tenant boundary, executed rather than described.
//
// Two gaps this closes.
//
// 1. imports/server/csaf/ownership.js has never been run by any test. It is the
//    single lookup behind CSAF.EncodeModuleIds, CSAF.DecodeProductIds and the
//    removal path - "does the caller's company own this id?" - and every existing
//    assertion about it is either a source-text match
//    (csaf-product-id-wiring.source.unit.spec.js) or a property of a spec-local
//    fake. In particular, csaf-product-id.unit.spec.js's "a PRODUCT id does not
//    pass the module check" asserts that the spec's own MODULE_OWNERSHIP table
//    omits the product id; it cannot say anything about the shipped lookup only
//    querying Modules. Here the shipped source runs against recording collections.
//
// 2. AC28 - "an undecodable token is skipped" - is currently unfalsifiable.
//    csaf-product-id.unit.spec.js drives the lifted remove.js block with an
//    ownership fake keyed by module id, and `undefined` is never a key of that
//    table, so the AC29 ownership filter drops undecodable tokens even when the
//    AC28 decode filter is gone. Deleting
//    `.filter(moduleId => typeof moduleId === 'string' && moduleId !== '')`
//    from remove.js leaves that suite fully green (verified). The block below
//    drives the same lifted code with ownership that accepts EVERYTHING, so the
//    decode filter is the only thing left standing between a garbage token and
//    unmuteVulnerability / openRisk.
//
// Both remove.js and ownership.js import Meteor, so both are lifted out of the
// shipped source at test time and executed. Nothing here is a
// re-implementation; every anchor throws loudly if the source changes shape.
// ---------------------------------------------------------------------------
const fs = require('fs');
const path = require('path');
const _ = require('underscore');

const REPO_ROOT = path.join(__dirname, '../..');
const OWNERSHIP_JS = 'imports/server/csaf/ownership.js';
const REMOVE_JS = 'imports/lib/interactors/csaf/remove.js';
const CODEC_JS = 'imports/server/csaf/productIdCodec.js';

const {createProductIdCodec} = require(path.join(REPO_ROOT, CODEC_JS));

const CO = 'company-own';
const OTHER_CO = 'company-other';

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

function readRepo(rel) {
  return fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
}

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => (/^\s*\/\//.test(line) ? '' : line))
    .join('\n');
}

// Slice from `marker` to the character closing the first `open` after it. The
// error message names the file it was slicing, so a failure points at the right
// source rather than at whichever file the helper was first written for.
function sliceBalanced(source, marker, open, close, fileLabel) {
  const start = source.indexOf(marker);
  if (start === -1) {
    throw new Error(
      `${fileLabel} no longer contains \`${marker}\`; re-anchor this spec, never delete it`);
  }
  let depth = 0;
  for (let i = source.indexOf(open, start); i < source.length; i += 1) {
    if (source[i] === open) depth += 1;
    else if (source[i] === close) {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced ${open}${close} while slicing ${marker} from ${fileLabel}`);
}

function substitute(source, pattern, replacement, what) {
  const next = source.replace(pattern, replacement);
  if (next === source) {
    throw new Error(`csaf-tenant-scope: could not ${what}; re-anchor this spec against the source`);
  }
  return next;
}

// --- ownership.js, lifted whole --------------------------------------------
//
// Its two collection imports become injected free variables; everything else -
// the selector, the projection, the empty-request short circuit, the two-query
// split - is the shipped code.
const OWNERSHIP_SRC = (function buildOwnershipSource() {
  let source = stripComments(readRepo(OWNERSHIP_JS));
  source = substitute(source,
    /^import\s+Modules\s+from\s+'\/imports\/lib\/collections\/modules';?[ \t]*$/m, '',
    'remove the Modules import from ownership.js');
  source = substitute(source,
    /^import\s+Products\s+from\s+'\/imports\/lib\/collections\/products';?[ \t]*$/m, '',
    'remove the Products import from ownership.js');
  source = substitute(source, /^export async function /gm, 'async function ',
    'strip the ESM export keyword from ownership.js');
  return source;
})();

const loadOwnership = new Function(
  'Modules', 'Products',
  `${OWNERSHIP_SRC}\nreturn {filterOwnedModuleIds, filterOwnedIds};`);

/**
 * A recording stand-in for a Mongo.Collection.
 *
 * `fetch` is present but throws: Meteor 3 made the synchronous cursor API
 * client-only, so a regression back to `fetch()` on the server must surface as a
 * failure here rather than as a silent empty result in production.
 */
function fakeCollection(name, docsById, log) {
  return {
    find(selector, options) {
      log.push({collection: name, selector, options});
      return {
        fetch() {
          throw new Error(`${name}.find().fetch() is client-only in Meteor 3 - use fetchAsync()`);
        },
        async fetchAsync() {
          const ids = (selector && selector._id && selector._id.$in) || [];
          return ids
            .filter((id) => Object.prototype.hasOwnProperty.call(docsById, id)
              && docsById[id] === selector.companyId)
            .map((id) => ({_id: id}));
        }
      };
    }
  };
}

// m1/m2 are the caller's modules, mForeign belongs to another tenant.
// p1 is the caller's PRODUCT - owned by the same company, but not a module.
const MODULES = {m1: CO, m2: CO, mForeign: OTHER_CO};
const PRODUCTS = {p1: CO, pForeign: OTHER_CO};

function ownershipWorld() {
  const log = [];
  const api = loadOwnership(
    fakeCollection('Modules', MODULES, log),
    fakeCollection('Products', PRODUCTS, log));
  return {log, ...api};
}

describe('the ownership.js source under test really came out of ownership.js', () => {
  it('lifted both lookups and the shipped selector', () => {
    expect(OWNERSHIP_SRC).toContain('filterOwnedModuleIds');
    expect(OWNERSHIP_SRC).toContain('filterOwnedIds');
    expect(OWNERSHIP_SRC).toContain('fetchAsync');
    // The selector is now built over a chunk of the id list rather than all of
    // it (see the chunking block below), but companyId is still part of it - a
    // selector that lost the tenant scope while gaining chunking would be the
    // one regression this assertion exists to catch.
    expect(OWNERSHIP_SRC).toMatch(/\{_id: \{\$in: ids\.slice\([^)]*\)\}, companyId\}/);
  });
});

describe('filterOwnedIds: the shared modules-or-products tenant lookup', () => {
  it('returns exactly the ids the company owns, across both collections', async () => {
    const {filterOwnedIds} = ownershipWorld();
    const owned = await filterOwnedIds(['m1', 'p1', 'mForeign', 'pForeign', 'nowhere'], CO);
    expect(owned instanceof Set).toBe(true);
    expect([...owned].sort()).toEqual(['m1', 'p1']);
  });

  it('queries with a tenant-scoped selector and an _id-only projection', async () => {
    const world = ownershipWorld();
    await world.filterOwnedIds(['m1', 'p1'], CO);
    world.log.forEach((call) => {
      expect(call.selector.companyId).toBe(CO);
      expect(Array.isArray(call.selector._id.$in)).toBe(true);
      expect(call.options).toEqual({fields: {_id: 1}});
    });
  });

  it('asks Products only about the ids Modules did not already account for', async () => {
    const world = ownershipWorld();
    await world.filterOwnedIds(['m1', 'p1', 'nowhere'], CO);
    expect(world.log.map((call) => call.collection)).toEqual(['Modules', 'Products']);
    expect(world.log[0].selector._id.$in).toEqual(['m1', 'p1', 'nowhere']);
    expect(world.log[1].selector._id.$in).toEqual(['p1', 'nowhere']);
  });

  it('skips the Products query entirely when Modules already matched everything', async () => {
    const world = ownershipWorld();
    await world.filterOwnedIds(['m1', 'm2'], CO);
    expect(world.log.map((call) => call.collection)).toEqual(['Modules']);
  });

  it('uses fetchAsync, not the client-only fetch()', async () => {
    // The fake throws on fetch(); reaching a result at all proves fetchAsync ran.
    const {filterOwnedIds} = ownershipWorld();
    await expect(filterOwnedIds(['m1'], CO)).resolves.toBeInstanceOf(Set);
  });
});

describe('filterOwnedIds: a missing company must never widen the query', () => {
  // The dangerous shape this guards: `find({_id: {$in: ids}, companyId: undefined})`
  // matches every document that has no companyId field at all. Short-circuiting
  // before the query is what keeps a caller with no resolvable company from
  // owning the untenanted remainder of the database.
  [undefined, null, ''].forEach((companyId) => {
    it(`returns an empty set and issues NO query for companyId=${JSON.stringify(companyId)}`, async () => {
      const world = ownershipWorld();
      const owned = await world.filterOwnedIds(['m1', 'p1'], companyId);
      expect([...owned]).toEqual([]);
      expect(world.log).toEqual([]);
    });
  });

  it('NON-VACUITY: the same call WITH a company does query and does return ids', async () => {
    const world = ownershipWorld();
    const owned = await world.filterOwnedIds(['m1', 'p1'], CO);
    expect([...owned].sort()).toEqual(['m1', 'p1']);
    expect(world.log.length).toBeGreaterThan(0);
  });

  it('returns an empty set and issues no query for an empty or non-array id list', async () => {
    const world = ownershipWorld();
    expect([...await world.filterOwnedIds([], CO)]).toEqual([]);
    expect([...await world.filterOwnedIds(undefined, CO)]).toEqual([]);
    expect([...await world.filterOwnedIds('m1', CO)]).toEqual([]);
    expect(world.log).toEqual([]);
  });
});

describe('the $in lookups are chunked, so one document cannot build one huge query', () => {
  // Security review finding 2. remove.js hands every decoded product_id of a
  // CSAF document to filterOwnedModuleIds in one call, and neither
  // csaf/create.js nor CSAFSchema caps that document's size - so the id list, and
  // therefore the $in array, was bounded only by what the caller uploaded. A
  // multi-megabyte $in is a Mongo document-size and planner problem, not a
  // tenant-isolation one, but it is entirely caller-chosen.
  const CHUNK = 1000;

  function manyIds(count, prefix = 'bulk') {
    return Array.from({length: count}, (_unused, index) => `${prefix}-${index}`);
  }

  it('splits a large id list into several bounded queries', async () => {
    const world = ownershipWorld();
    await world.filterOwnedModuleIds(manyIds(CHUNK * 2 + 1), CO);
    const queries = world.log.filter((entry) => entry.collection === 'Modules');
    expect(queries.length).toBe(3);
    queries.forEach((entry) => {
      expect(entry.selector._id.$in.length).toBeLessThanOrEqual(CHUNK);
      // The tenant scope is on EVERY chunk, not just the first.
      expect(entry.selector.companyId).toBe(CO);
      expect(entry.options).toEqual({fields: {_id: 1}});
    });
    expect(queries.reduce((total, entry) => total + entry.selector._id.$in.length, 0))
      .toBe(CHUNK * 2 + 1);
  });

  it('still returns every owned id across the chunk boundary', async () => {
    const world = ownershipWorld();
    // m1 and m2 sit either side of a boundary in a list far larger than one chunk.
    const ids = [...manyIds(CHUNK - 1), 'm1', ...manyIds(CHUNK, 'more'), 'm2'];
    const owned = await world.filterOwnedModuleIds(ids, CO);
    expect([...owned].sort()).toEqual(['m1', 'm2']);
  });

  it('chunks the products lookup too, for the ids the modules lookup did not claim', async () => {
    const world = ownershipWorld();
    const ids = [...manyIds(CHUNK * 2), 'p1'];
    const owned = await world.filterOwnedIds(ids, CO);
    expect([...owned]).toEqual(['p1']);
    expect(world.log.filter((entry) => entry.collection === 'Modules').length).toBe(3);
    expect(world.log.filter((entry) => entry.collection === 'Products').length).toBe(3);
  });

  it('NON-VACUITY: an ordinary list is still a single query per collection', async () => {
    const world = ownershipWorld();
    await world.filterOwnedIds(['m1', 'p1'], CO);
    expect(world.log.filter((entry) => entry.collection === 'Modules').length).toBe(1);
    expect(world.log.filter((entry) => entry.collection === 'Products').length).toBe(1);
  });
});

describe('filterOwnedModuleIds: a product id must not authorise a module write', () => {
  it('accepts the company\'s modules', async () => {
    const {filterOwnedModuleIds} = ownershipWorld();
    expect([...await filterOwnedModuleIds(['m1', 'm2'], CO)].sort()).toEqual(['m1', 'm2']);
  });

  it('rejects the company\'s own PRODUCT id, and never queries Products at all', async () => {
    // This is the assertion csaf-product-id.unit.spec.js could not make: there,
    // the "product id fails the module check" outcome came from a fake table that
    // simply omitted p1. Here p1 genuinely exists, genuinely belongs to CO, and is
    // still refused - because the shipped lookup only ever reads Modules.
    const world = ownershipWorld();
    const owned = await world.filterOwnedModuleIds(['m1', 'p1'], CO);
    expect([...owned]).toEqual(['m1']);
    expect(world.log.map((call) => call.collection)).toEqual(['Modules']);
  });

  it('NON-VACUITY: filterOwnedIds accepts that very same product id', async () => {
    // Proves the refusal above is the modules-only scope, not p1 being unownable.
    const {filterOwnedIds} = ownershipWorld();
    expect([...await filterOwnedIds(['p1'], CO)]).toEqual(['p1']);
  });

  it('rejects another tenant\'s module', async () => {
    const {filterOwnedModuleIds} = ownershipWorld();
    expect([...await filterOwnedModuleIds(['m1', 'mForeign'], CO)]).toEqual(['m1']);
  });

  it('returns an empty set and issues no query without a company', async () => {
    const world = ownershipWorld();
    expect([...await world.filterOwnedModuleIds(['m1'], undefined)]).toEqual([]);
    expect(world.log).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC28, with the ownership check taken out of the way.
// ---------------------------------------------------------------------------

const REMOVE_SRC = stripComments(readRepo(REMOVE_JS));
const REMOVE_ACTIONS_BLOCK = sliceBalanced(
  REMOVE_SRC,
  'if(params && (params.unmuteVulnerabilities || params.openRisks)){',
  '{', '}', REMOVE_JS);

// `decodeToken` rather than `decodeProductId`: the block now goes through the
// per-document decoder built in remove()'s body (dedupe + cap, see
// test_api/specs/csaf-remove-decode-bounds.unit.spec.js), which is declared
// outside this block and so arrives here as a free variable. Injecting a plain
// codec function keeps THIS spec about which ids reach the write.
const runRemoveActions = new AsyncFunction(
  'params', 'csaf', 'user', '_', 'decodeToken', 'unmuteVulnerability', 'openRisk',
  'filterOwnedModuleIds',
  REMOVE_ACTIONS_BLOCK);

function makeCodec() {
  // A pass-through v2 pair: this block is about which ids reach the write, not
  // about the cipher (csaf-product-id-real-crypto.unit.spec.js covers that), so
  // the encoding is kept trivially invertible.
  return createProductIdCodec({
    encrypt: (id) => `v2:${Buffer.from(String(id), 'utf8').toString('base64')}`,
    decrypt: (token) => {
      const body = token.slice(3);
      const decoded = Buffer.from(body, 'base64').toString('utf8');
      return Buffer.from(decoded, 'utf8').toString('base64') === body ? decoded : undefined;
    },
    versionPrefix: 'v2:'
  });
}

function csafDocument(productIds) {
  return {
    data: JSON.stringify({
      document: {category: 'csaf_vex'},
      vulnerabilities: [{cve: 'CVE-2026-1234', product_status: {known_affected: productIds}}]
    })
  };
}

/**
 * Run the lifted removal block with an ownership function of the caller's
 * choosing, so each test decides which guard is under examination.
 */
async function runRemoval(productIds, filterOwnedModuleIds) {
  const codec = makeCodec();
  const world = {unmuted: [], risks: [], ownershipCalls: []};
  await runRemoveActions(
    {unmuteVulnerabilities: true, openRisks: true},
    csafDocument(productIds),
    {_id: 'u-1', profile: {companyId: CO}},
    _,
    codec.decodeProductId,
    async (cveKey, moduleId) => world.unmuted.push({cveKey, moduleId}),
    async (user, cveKey, moduleId) => world.risks.push({cveKey, moduleId}),
    async (ids, companyId) => {
      world.ownershipCalls.push({ids, companyId});
      return filterOwnedModuleIds(ids, companyId);
    });
  return world;
}

// Ownership that owns literally everything it is asked about. With this in place
// the ONLY filter left in remove.js is the decode guard, so AC28 becomes
// falsifiable: remove the guard and undefined reaches the writes.
const OWNS_EVERYTHING = (ids) => new Set(ids);

describe('the remove.js block under test really came out of remove.js', () => {
  it('lifted the decode, the ownership scope and both write actions', () => {
    expect(REMOVE_ACTIONS_BLOCK).toContain('decodeToken(');
    // The AC29 fix itself. csaf-product-id.unit.spec.js's equivalent meta-test
    // omits this, so its ownership scoping could be deleted without the "the block
    // really came out of remove.js" test noticing.
    expect(REMOVE_ACTIONS_BLOCK).toContain('filterOwnedModuleIds(');
    expect(REMOVE_ACTIONS_BLOCK).toContain('unmuteVulnerability(');
    expect(REMOVE_ACTIONS_BLOCK).toContain('openRisk(');
  });

  it('still drops what it could not decode before it scopes anything', () => {
    // Pinned as text as well as behaviourally: this exact filter is the guard the
    // tests below exercise, and a reviewer should be able to see it named.
    expect(REMOVE_ACTIONS_BLOCK)
      .toMatch(/\.filter\(\s*moduleId\s*=>\s*typeof moduleId === 'string' && moduleId !== ''\s*\)/);
  });
});

describe('AC28 unmasked: with ownership granting everything, the decode guard alone must hold', () => {
  it('a document of nothing but garbage tokens performs no write', async () => {
    const world = await runRemoval(
      ['hello', 'total-garbage', 'v2:not-base64!!!', 'v2:', ''], OWNS_EVERYTHING);
    expect(world.unmuted).toEqual([]);
    expect(world.risks).toEqual([]);
  });

  it('neither write is ever handed undefined or an empty id', async () => {
    const codec = makeCodec();
    const world = await runRemoval(
      [codec.encodeProductId('m1'), 'hello', 'v2:not-base64!!!', 'nope'],
      OWNS_EVERYTHING);
    const calls = [...world.unmuted, ...world.risks];
    expect(calls).toHaveLength(2);
    calls.forEach((call) => {
      expect(typeof call.moduleId).toBe('string');
      expect(call.moduleId).not.toBe('');
      expect(call.moduleId).toBe('m1');
    });
  });

  it('the ownership lookup is never even asked about an undecodable token', async () => {
    // Both directions: the decodable id IS presented for scoping, the garbage is
    // NOT. A regression that merely reordered the filters would still pass the
    // two tests above; this one would not.
    const codec = makeCodec();
    const world = await runRemoval([codec.encodeProductId('m1'), 'hello'], OWNS_EVERYTHING);
    expect(world.ownershipCalls).toHaveLength(1);
    expect(world.ownershipCalls[0].ids).toEqual(['m1']);
    expect(world.ownershipCalls[0].companyId).toBe(CO);
  });

  it('NON-VACUITY: the same run with a decodable-only document does write', async () => {
    const codec = makeCodec();
    const world = await runRemoval([codec.encodeProductId('m1')], OWNS_EVERYTHING);
    expect(world.unmuted).toEqual([{cveKey: 'CVE-2026-1234', moduleId: 'm1'}]);
  });
});

// ---------------------------------------------------------------------------
// The composition: the lifted removal block driven by the SHIPPED ownership
// lookup, with no hand-written ownership table anywhere in the path.
// ---------------------------------------------------------------------------
describe('AC29 composed: removal + the real ownership lookup, no ownership fake', () => {
  // No default for callerCompanyId: a default would silently substitute CO for the
  // "user has no company" case, which is exactly the case one of the tests below
  // is about.
  async function runComposed(productIds, callerCompanyId) {
    const codec = makeCodec();
    const log = [];
    const {filterOwnedModuleIds} = loadOwnership(
      fakeCollection('Modules', MODULES, log),
      fakeCollection('Products', PRODUCTS, log));
    const world = {unmuted: [], risks: [], log};
    await runRemoveActions(
      {unmuteVulnerabilities: true, openRisks: true},
      csafDocument(productIds),
      {_id: 'u-1', profile: {companyId: callerCompanyId}},
      _,
      codec.decodeProductId,
      async (cveKey, moduleId) => world.unmuted.push({cveKey, moduleId}),
      async (user, cveKey, moduleId) => world.risks.push({cveKey, moduleId}),
      filterOwnedModuleIds);
    return world;
  }

  it('a valid token naming another tenant\'s module writes nothing', async () => {
    const forged = makeCodec().encodeProductId('mForeign');
    expect(makeCodec().decodeProductId(forged)).toBe('mForeign');   // it DOES decode
    const world = await runComposed([forged], CO);
    expect(world.unmuted).toEqual([]);                              // and still writes nothing
    expect(world.risks).toEqual([]);
  });

  it('a token naming the caller\'s OWN module does write - decode is not the defence', async () => {
    // Non-vacuity for the test above: the token path is live, and what stopped it
    // was the tenant check, not an unreadable token.
    const forged = makeCodec().encodeProductId('m1');
    const world = await runComposed([forged], CO);
    expect(world.unmuted).toEqual([{cveKey: 'CVE-2026-1234', moduleId: 'm1'}]);
  });

  it('a token naming the caller\'s own PRODUCT writes nothing (modules-only scope)', async () => {
    const codec = makeCodec();
    const world = await runComposed([codec.encodeProductId('p1')], CO);
    expect(world.unmuted).toEqual([]);
    expect(world.log.map((call) => call.collection)).toEqual(['Modules']);
  });

  it('a token naming an id that exists nowhere writes nothing', async () => {
    const codec = makeCodec();
    const world = await runComposed([codec.encodeProductId('deleted-module')], CO);
    expect(world.unmuted).toEqual([]);
  });

  it('the same document flips outcome with the caller\'s company', async () => {
    const codec = makeCodec();
    const token = codec.encodeProductId('mForeign');
    expect((await runComposed([token], CO)).unmuted).toEqual([]);
    expect((await runComposed([token], OTHER_CO)).unmuted)
      .toEqual([{cveKey: 'CVE-2026-1234', moduleId: 'mForeign'}]);
  });

  it('a caller with no company writes nothing, and issues no query', async () => {
    const codec = makeCodec();
    const world = await runComposed([codec.encodeProductId('m1')], undefined);
    expect(world.unmuted).toEqual([]);
    expect(world.log).toEqual([]);
  });

  it('mixed document: only the caller\'s own decodable module ids act', async () => {
    const codec = makeCodec();
    const world = await runComposed([
      codec.encodeProductId('m1'),
      codec.encodeProductId('m2'),
      codec.encodeProductId('p1'),
      codec.encodeProductId('mForeign'),
      'hello'
    ], CO);
    expect(world.unmuted.map((call) => call.moduleId).sort()).toEqual(['m1', 'm2']);
    expect(world.risks.map((call) => call.moduleId).sort()).toEqual(['m1', 'm2']);
    // One indexed $in for the whole document, not one query per token.
    expect(world.log.map((call) => call.collection)).toEqual(['Modules']);
    expect(world.log[0].selector._id.$in.sort()).toEqual(['m1', 'm2', 'mForeign', 'p1']);
  });
});
