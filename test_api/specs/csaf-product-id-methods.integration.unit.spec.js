// ---------------------------------------------------------------------------
// CSAF.EncodeModuleIds / CSAF.DecodeProductIds as an actual method call.
//
// What existed before this file
// -----------------------------
// - csaf-product-id.unit.spec.js drives the PURE handlers in
//   imports/server/csaf/productIdMethods.js with hand-written deps. Excellent
//   coverage of the handlers, but it never touches the registration, the DDP
//   authentication guard, or the real ownership lookup.
// - csaf-product-id-wiring.source.unit.spec.js covers AC25 (the two methods are
//   not in PUBLIC_METHODS) with regexes over source text.
//
// What this file does
// -------------------
// It assembles the real server-side call path and calls the methods:
//
//   security-guard.js  guardMethodHandler   (DDP auth + account-status gate)
//     -> startup/server/csaf.js             (the registration itself)
//       -> productIdMethods.js              (the pure handlers, required directly)
//         -> productIdCodec.js              (the real codec)
//         -> ownership.js                   (the real tenant lookup)
//
// Only Meteor itself, the collections and the CSAF write interactors are stood
// in for. Every guard in that chain is the shipped source, lifted at test time,
// so AC25's 401 is an observed outcome rather than a regex match. The Community
// Edition has no feature gate on CSAF at all (every company has every feature),
// so this file no longer exercises a licence path.
// ---------------------------------------------------------------------------
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '../..');
const CSAF_STARTUP_JS = 'imports/startup/server/csaf.js';
const SECURITY_GUARD_JS = 'imports/startup/server/security-guard.js';
const ACCOUNT_STATUS_JS = 'imports/lib/accountStatus.js';
const OWNERSHIP_JS = 'imports/server/csaf/ownership.js';

const {createProductIdCodec} = require(path.join(REPO_ROOT, 'imports/server/csaf/productIdCodec.js'));
const {encodeModuleIds, decodeProductIds, CSAF_ID_BATCH_MAX} =
  require(path.join(REPO_ROOT, 'imports/server/csaf/productIdMethods.js'));

const CO = 'company-1';
const OTHER_CO = 'company-other';

// ---------------------------------------------------------------------------
// Lifting helpers
// ---------------------------------------------------------------------------

function readRepo(rel) {
  return fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
}

function substitute(source, pattern, replacement, what) {
  const next = source.replace(pattern, replacement);
  if (next === source) {
    throw new Error(
      `csaf-product-id-methods: could not ${what}. The shipped source changed shape; ` +
      're-anchor this spec against it - never weaken or delete it.');
  }
  return next;
}

// Drop every top-level `import ...;` statement (single or multi-line) and the ESM
// export keyword, so the remainder can run inside a `new Function` with the
// former imports supplied as free variables.
function toRunnable(rel, what) {
  let source = readRepo(rel);
  source = substitute(source, /^import[\s\S]*?from\s*'[^']*';[ \t]*$/gm, '',
    `strip the imports from ${what}`);
  source = source.replace(/^import\s+'[^']*';[ \t]*$/gm, '');
  return source.replace(/^export\s+(?=(?:async\s+)?function|const|let|class)/gm, '');
}

// ---------------------------------------------------------------------------
// The pieces, each lifted from its shipped file
// ---------------------------------------------------------------------------

// isomorphic, no imports at all - just needs the export keyword removed.
const accountStatus = new Function(
  `${readRepo(ACCOUNT_STATUS_JS).replace(/^export /gm, '')}
   return {ACCOUNT_STATUS, ACCOUNT_STATUS_FIELD, accountStatusOf};`)();

// security-guard.js: everything above the Meteor.startup installer. The installer
// itself is replicated below, deliberately, so the wrapping this spec exercises is
// the same wrapping production performs.
const SECURITY_GUARD_SRC = (function () {
  const source = toRunnable(SECURITY_GUARD_JS, 'security-guard.js');
  const cut = source.indexOf('Meteor.startup(');
  if (cut === -1) {
    throw new Error('security-guard.js no longer installs its guard in Meteor.startup; re-anchor');
  }
  return source.slice(0, cut);
})();
const loadSecurityGuard = new Function(
  'Meteor', 'accountStatusOf', 'ACCOUNT_STATUS', 'ACCOUNT_STATUS_FIELD',
  `${SECURITY_GUARD_SRC}\nreturn {guardMethodHandler, PUBLIC_METHODS, _clearAccountActiveCache};`);

// ownership.js: the real tenant lookup, with the two collections injected.
const OWNERSHIP_SRC = (function () {
  let source = readRepo(OWNERSHIP_JS);
  source = substitute(source,
    /^import\s+Modules\s+from\s+'[^']*';[ \t]*$/m, '', 'strip the Modules import from ownership.js');
  source = substitute(source,
    /^import\s+Products\s+from\s+'[^']*';[ \t]*$/m, '', 'strip the Products import from ownership.js');
  return source.replace(/^export async function /gm, 'async function ');
})();
const loadOwnership = new Function('Modules', 'Products',
  `${OWNERSHIP_SRC}\nreturn {filterOwnedIds, filterOwnedModuleIds};`);

// startup/server/csaf.js: the registration under test. No `gatedByFeature`
// dependency any more - every company has every feature.
const CSAF_STARTUP_SRC = toRunnable(CSAF_STARTUP_JS, 'startup/server/csaf.js');
const loadCsafRegistration = new Function(
  'Meteor', 'CSAFCreate', 'CSAFRemove', 'CSAFValidate', 'CSAFUpdate', 'CSAFCreateOrUpdate',
  'CSAFFindOne', 'encodeIdMap', 'decodeProductId', 'filterOwnedIds',
  'encodeModuleIds', 'decodeProductIds',
  CSAF_STARTUP_SRC);

// ---------------------------------------------------------------------------
// The world
// ---------------------------------------------------------------------------

const MODULES = {m1: CO, m2: CO, mForeign: OTHER_CO};
const PRODUCTS = {p1: CO, pForeign: OTHER_CO};

function fakeCollection(docsById) {
  return {
    find(selector) {
      const ids = (selector && selector._id && selector._id.$in) || [];
      return {
        async fetchAsync() {
          return ids
            .filter((id) => Object.prototype.hasOwnProperty.call(docsById, id)
              && docsById[id] === selector.companyId)
            .map((id) => ({_id: id}));
        }
      };
    },
    async findOneAsync(id) {
      return Object.prototype.hasOwnProperty.call(docsById, id)
        ? {_id: id, companyId: docsById[id]} : undefined;
    }
  };
}

class FakeMeteorError extends Error {
  constructor(error, reason) {
    super(`[${error}] ${reason}`);
    this.error = error;
    this.reason = reason;
  }
}

// Meteor.EnvironmentVariable, as security-guard.js uses it: a value visible to
// everything running inside withValue(). A plain variable is faithful here
// because every call below is awaited to completion before the next begins.
class FakeEnvironmentVariable {
  constructor() {
    this.value = undefined;
  }

  get() {
    return this.value;
  }

  withValue(value, fn) {
    const previous = this.value;
    this.value = value;
    try {
      return fn();
    } finally {
      this.value = previous;
    }
  }
}

/**
 * Build the whole chain for one scenario.
 *
 * @param userDoc   overrides merged into the caller's user document
 */
function buildWorld({companyId = CO, accountStatusValue} = {}) {
  const calls = {create: 0, remove: 0, validate: 0, update: 0, createOrUpdate: 0, findOne: 0};
  const userId = `user-${companyId}-${accountStatusValue || 'active'}`;
  const userDoc = {
    _id: userId,
    profile: {companyId},
    ...(accountStatusValue ? {accountStatus: accountStatusValue} : {})
  };

  const Meteor = {
    Error: FakeMeteorError,
    EnvironmentVariable: FakeEnvironmentVariable,
    methods(map) {
      this._registered = map;
    },
    async userAsync() {
      return userDoc;
    },
    users: {
      async findOneAsync() {
        return userDoc;
      }
    }
  };

  const {guardMethodHandler, PUBLIC_METHODS, _clearAccountActiveCache} =
    loadSecurityGuard(Meteor, accountStatus.accountStatusOf,
      accountStatus.ACCOUNT_STATUS, accountStatus.ACCOUNT_STATUS_FIELD);
  _clearAccountActiveCache();

  const {filterOwnedIds} = loadOwnership(fakeCollection(MODULES), fakeCollection(PRODUCTS));

  // The real codec, with a trivially invertible v2 pair. The cipher itself is
  // covered by csaf-product-id-real-crypto.unit.spec.js; what matters here is the
  // prefix routing, which stays real.
  const codec = createProductIdCodec({
    encrypt: (id) => `v2:${Buffer.from(String(id), 'utf8').toString('base64')}`,
    decrypt: (token) => {
      const body = token.slice(3);
      const decoded = Buffer.from(body, 'base64').toString('utf8');
      return Buffer.from(decoded, 'utf8').toString('base64') === body ? decoded : undefined;
    },
    versionPrefix: 'v2:'
  });

  loadCsafRegistration(
    Meteor,
    async () => { calls.create += 1; return 'created'; },
    async () => { calls.remove += 1; return 'removed'; },
    async () => { calls.validate += 1; return 'validated'; },
    async () => { calls.update += 1; return 'updated'; },
    async () => { calls.createOrUpdate += 1; return 'upserted'; },
    async () => { calls.findOne += 1; return 'found'; },
    codec.encodeIdMap,
    codec.decodeProductId,
    filterOwnedIds,
    encodeModuleIds,
    decodeProductIds);

  const registered = Meteor._registered;
  if (!registered) {
    throw new Error('startup/server/csaf.js no longer registers through Meteor.methods; re-anchor');
  }

  // Exactly what security-guard.js's Meteor.startup installer does to every
  // registered handler.
  const guarded = {};
  Object.keys(registered).forEach((name) => {
    guarded[name] = guardMethodHandler(name, registered[name]);
  });

  // A call arriving over a client DDP connection from an authenticated user.
  const asUser = (name, ...args) =>
    guarded[name].apply({connection: {id: 'ddp-1'}, userId}, args);
  // A call arriving over a client DDP connection with no login.
  const anonymous = (name, ...args) =>
    guarded[name].apply({connection: {id: 'ddp-2'}, userId: null}, args);
  // A trusted server-to-server call (interactor, REST apiUser, collection hook).
  const internal = (name, ...args) => guarded[name].apply({connection: null, userId: null}, args);

  return {calls, codec, registered, guarded, PUBLIC_METHODS, asUser, anonymous, internal, userId};
}

async function caught(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to reject, but it resolved');
}

const GATED_METHODS = ['CSAF.Create', 'CSAF.Remove', 'CSAF.Validate', 'CSAF.Update',
  'CSAF.CreateOrUpdate'];
const CALL_KEY = {
  'CSAF.Create': 'create',
  'CSAF.Remove': 'remove',
  'CSAF.Validate': 'validate',
  'CSAF.Update': 'update',
  'CSAF.CreateOrUpdate': 'createOrUpdate'
};

// ---------------------------------------------------------------------------

describe('the chain assembled here really is the shipped one', () => {
  it('registers the seven CSAF methods from startup/server/csaf.js', () => {
    const {registered} = buildWorld();
    expect(Object.keys(registered).sort()).toEqual([
      'CSAF.Create', 'CSAF.CreateOrUpdate', 'CSAF.DecodeProductIds', 'CSAF.EncodeModuleIds',
      'CSAF.FindOne', 'CSAF.Remove', 'CSAF.Update', 'CSAF.Validate'
    ]);
  });

  it('lifted the real guards, not stand-ins', () => {
    expect(SECURITY_GUARD_SRC).toContain('Authentication required');
    expect(SECURITY_GUARD_SRC).toContain('PUBLIC_METHODS');
    expect(OWNERSHIP_SRC).toContain('fetchAsync');
  });
});

describe('the product_id methods and the gated CSAF methods run with no feature licence involved', () => {
  it('EncodeModuleIds succeeds for an authenticated company member', async () => {
    const world = buildWorld();
    const map = await world.asUser('CSAF.EncodeModuleIds', ['m1', 'm2']);
    expect(Object.keys(map).sort()).toEqual(['m1', 'm2']);
    expect(map.m1.startsWith('v2:')).toBe(true);
    expect(world.codec.decodeProductId(map.m1)).toBe('m1');
  });

  it('DecodeProductIds succeeds for the same company', async () => {
    const world = buildWorld();
    const token = world.codec.encodeProductId('m1');
    await expect(world.asUser('CSAF.DecodeProductIds', [token])).resolves.toEqual({[token]: 'm1'});
  });

  it('every CSAF write method reaches its interactor - no gate stands in the way', async () => {
    const world = buildWorld();
    for (const name of GATED_METHODS) {
      await expect(world.asUser(name, {})).resolves.toBeDefined();
      expect(world.calls[CALL_KEY[name]]).toBe(1);
    }
  });

  it('CSAF.FindOne remains ungated, same as the write methods', async () => {
    const world = buildWorld();
    await expect(world.asUser('CSAF.FindOne', 'id')).resolves.toBe('found');
  });
});

describe('AC25: neither method is reachable without a login', () => {
  it('an unauthenticated DDP call is rejected with 401', async () => {
    const world = buildWorld();
    for (const name of ['CSAF.EncodeModuleIds', 'CSAF.DecodeProductIds']) {
      const error = await caught(world.anonymous(name, ['m1']));
      expect(error.error).toBe(401);
      expect(error.reason).toBe('Authentication required');
    }
  });

  it('neither name is in the PUBLIC_METHODS allowlist', () => {
    const {PUBLIC_METHODS} = buildWorld();
    expect(PUBLIC_METHODS.has('CSAF.EncodeModuleIds')).toBe(false);
    expect(PUBLIC_METHODS.has('CSAF.DecodeProductIds')).toBe(false);
  });

  it('NON-VACUITY: the allowlist is real - `login` is in it and is not rejected', () => {
    const {PUBLIC_METHODS} = buildWorld();
    expect(PUBLIC_METHODS.has('login')).toBe(true);
    expect(PUBLIC_METHODS.has('createUser')).toBe(true);
  });

  it('NON-VACUITY: the same call WITH a login gets through', async () => {
    const world = buildWorld();
    await expect(world.asUser('CSAF.EncodeModuleIds', ['m1'])).resolves.toHaveProperty('m1');
  });

  it('a trusted server-to-server call is not gated by the DDP guard', async () => {
    // publicVexKey.getFile reaches the codec in-process, but any interactor
    // calling these methods must not be treated as anonymous.
    const world = buildWorld();
    await expect(world.internal('CSAF.EncodeModuleIds', ['m1'])).resolves.toHaveProperty('m1');
  });

  it('a suspended account is refused', async () => {
    const world = buildWorld({accountStatusValue: 'suspended'});
    const error = await caught(world.asUser('CSAF.EncodeModuleIds', ['m1']));
    expect(error.error).toBe(403);
    expect(error.reason).toBe('Account suspended');
  });
});

describe('the method error contract, through the real registration and lookup', () => {
  it('AC18: a foreign id rejects the WHOLE batch with 403 and mints nothing', async () => {
    const world = buildWorld();
    const error = await caught(world.asUser('CSAF.EncodeModuleIds', ['m1', 'mForeign']));
    expect(error.error).toBe(403);
    expect(error.reason).toBe('Access Denied');
    expect(error instanceof FakeMeteorError).toBe(true);
  });

  it('AC19: a nonexistent id is refused IDENTICALLY to a foreign one', async () => {
    // The existing pure-handler test cannot show this: its ownership fake has no
    // notion of "exists in another tenant" versus "exists nowhere" - both are
    // simply absent from one table. Here mForeign is a real document owned by
    // another company and `no-such-id` is a real absence, and the two errors must
    // still be indistinguishable, or the method is an existence oracle.
    const world = buildWorld();
    const foreign = await caught(world.asUser('CSAF.EncodeModuleIds', ['mForeign']));
    const missing = await caught(world.asUser('CSAF.EncodeModuleIds', ['no-such-id']));
    expect(missing.error).toBe(foreign.error);
    expect(missing.reason).toBe(foreign.reason);
    expect(missing.message).toBe(foreign.message);
  });

  it('AC20: a product of the caller\'s company round-trips like a module', async () => {
    const world = buildWorld();
    const map = await world.asUser('CSAF.EncodeModuleIds', ['p1']);
    expect(world.codec.decodeProductId(map.p1)).toBe('p1');
    await expect(world.asUser('CSAF.DecodeProductIds', [map.p1])).resolves.toEqual({[map.p1]: 'p1'});
  });

  it('AC20: another company\'s product is refused exactly like a foreign module', async () => {
    const world = buildWorld();
    const product = await caught(world.asUser('CSAF.EncodeModuleIds', ['pForeign']));
    const module = await caught(world.asUser('CSAF.EncodeModuleIds', ['mForeign']));
    expect(product.error).toBe(module.error);
    expect(product.reason).toBe(module.reason);
  });

  it('the company comes from the logged-in user, never from the caller', async () => {
    // Same id, two callers. If companyId were spoofable the outcome would not flip.
    const own = buildWorld({companyId: CO});
    const other = buildWorld({companyId: OTHER_CO});
    await expect(own.asUser('CSAF.EncodeModuleIds', ['m1'])).resolves.toHaveProperty('m1');
    expect((await caught(other.asUser('CSAF.EncodeModuleIds', ['m1']))).error).toBe(403);
    await expect(other.asUser('CSAF.EncodeModuleIds', ['mForeign'])).resolves.toHaveProperty('mForeign');
  });

  it('AC26: a non-array argument is a 400 on both methods', async () => {
    const world = buildWorld();
    expect((await caught(world.asUser('CSAF.EncodeModuleIds', 'm1'))).reason).toBe('Invalid ids');
    expect((await caught(world.asUser('CSAF.DecodeProductIds', 'tok'))).reason).toBe('Invalid tokens');
    expect((await caught(world.asUser('CSAF.EncodeModuleIds', undefined))).error).toBe(400);
    expect((await caught(world.asUser('CSAF.DecodeProductIds', {0: 'a'}))).error).toBe(400);
  });

  it('AC26: a non-string element is a 400', async () => {
    const world = buildWorld();
    expect((await caught(world.asUser('CSAF.EncodeModuleIds', ['m1', 42]))).error).toBe(400);
    expect((await caught(world.asUser('CSAF.DecodeProductIds', ['t', '']))).error).toBe(400);
  });

  it('AC26: an oversized batch is a 400 naming the cap, checked before dedupe', async () => {
    const world = buildWorld();
    const repeated = new Array(CSAF_ID_BATCH_MAX + 1).fill('m1');   // one distinct id
    const error = await caught(world.asUser('CSAF.EncodeModuleIds', repeated));
    expect(error.error).toBe(400);
    expect(error.reason).toBe(`Too many ids (max ${CSAF_ID_BATCH_MAX})`);
    // NON-VACUITY: exactly at the cap the same shape is accepted.
    await expect(world.asUser('CSAF.EncodeModuleIds', new Array(CSAF_ID_BATCH_MAX).fill('m1')))
      .resolves.toEqual({m1: expect.any(String)});
  });

  it('an empty batch resolves to {} on both methods', async () => {
    // The frontend depends on this and could not enforce it:
    // fromVulnerabilityReport rejects with 'VEX: productIds map is required' when
    // productIds is not an object, so a report covering no modules would fail at
    // export if this ever returned undefined.
    const world = buildWorld();
    const encoded = await world.asUser('CSAF.EncodeModuleIds', []);
    const decoded = await world.asUser('CSAF.DecodeProductIds', []);
    expect(encoded).toEqual({});
    expect(decoded).toEqual({});
    expect(typeof encoded).toBe('object');
    expect(encoded).not.toBeUndefined();
  });

  it('AC22: decode reports null per token, and never leaks a non-owned id', async () => {
    const world = buildWorld();
    const foreign = world.codec.encodeProductId('mForeign');
    const missing = world.codec.encodeProductId('deleted-module');
    const own = world.codec.encodeProductId('m1');
    const garbage = 'definitely-not-a-token';
    const out = await world.asUser('CSAF.DecodeProductIds', [own, foreign, missing, garbage]);
    expect(out).toEqual({[own]: 'm1', [foreign]: null, [missing]: null, [garbage]: null});
    expect(JSON.stringify(out)).not.toContain('mForeign');
    expect(JSON.stringify(out)).not.toContain('deleted-module');
  });

  it('a `__proto__` token comes back as an own key, not a prototype write', async () => {
    // A product_id arrives from an UPLOADED document, so it can be any string.
    const world = buildWorld();
    const out = await world.asUser('CSAF.DecodeProductIds', ['__proto__', 'constructor']);
    expect(Object.prototype.hasOwnProperty.call(out, '__proto__')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(out, 'constructor')).toBe(true);
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    expect({}.polluted).toBeUndefined();
  });
});
