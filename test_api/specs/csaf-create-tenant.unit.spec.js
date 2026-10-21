/* eslint-disable no-undef */
// Cross-tenant authorization on CSAF creation.
//
// Two defects sat in imports/lib/interactors/csaf/create.js:
//
//   1. `const user = apiUser || await Meteor.userAsync();` trusted a CLIENT
//      argument as the authenticated principal. `vex.js:315` sends
//      `apiUser: Meteor.user()` evaluated IN THE BROWSER, so any authenticated
//      user could call `CSAF.Create` over raw DDP with
//      `apiUser: {profile: {companyId: '<victim>'}}` and have the DRAFT
//      inserted into - and the logEvent attributed to - another tenant.
//   2. There was no server-side role check at all. The
//      `['manager','company_security_manager']` gate lives in
//      report-vulnerability.js, i.e. in the browser.
//
// create.js imports meteor/* and cannot be `require`d under Jest, and this
// repo configures no moduleNameMapper for `meteor/*`. Rather than re-implement
// the interactor here (a copy that would agree with itself forever and prove
// nothing), this spec LIFTS the real source, strips only its import/export
// statements, and EXECUTES it with fakes injected for Meteor, Session, CSAF,
// Companies, Roles and extractTlp. The logic under test is the bytes that ship.
// If the file's import shape changes, the lift throws a loud re-anchoring
// message instead of passing against a stale copy - which is what the first
// describe block exists to prove.
//
// The shipped source is lifted as text and executed, not re-implemented.
const fs = require('fs');
const path = require('path');

const CREATE_JS = 'imports/lib/interactors/csaf/create.js';
const UPDATE_JS = 'imports/lib/interactors/csaf/update.js';
const CREATE_OR_UPDATE_JS = 'imports/lib/interactors/csaf/createOrUpdate.js';
const VEX_JS = 'imports/lib/converter/vex.js';

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8');
}

// Remove /* block */ comments and full-line // comments so a commented-out
// statement is NOT counted as live source.
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => (/^\s*\/\//.test(line) ? '' : line))
    .join('\n');
}

// ---------------------------------------------------------------------------
// Lifting create.js
// ---------------------------------------------------------------------------

const RE_ANCHOR =
  'imports/lib/interactors/csaf/create.js no longer has the module shape this ' +
  'spec lifts (ES imports + an optional `const {x} = require(...)` + a `create` ' +
  'function + `export default`). This spec EXECUTES the real source, so it has ' +
  'to be re-anchored on the new shape - never deleted, or the cross-tenant ' +
  'authorization fix loses its only behavioural coverage.';

// Turn module source into a callable factory. Only the module *linkage* is
// removed (import statements, the CommonJS require of the tlp helper, and the
// `export` keywords); every executable statement is left exactly as written.
function compileFrom(source) {
  const body = source
    // whole `import ... from '...';` statements, multi-line safe
    .replace(/^import[\s\S]*?from\s+'[^']*';[ \t]*$/gm, '')
    // `const {extractTlp} = require('/imports/lib/csaf/feedAccess');`
    .replace(/^const\s*\{[^}]*\}\s*=\s*require\([^)]*\);[ \t]*$/gm, '')
    .replace(/^export\s+default\s+\w+;[ \t]*$/gm, '')
    // keep named exports as plain declarations so the real values stay in scope
    .replace(/^export\s+(const|let|function)\s/gm, '$1 ');

  if (/\bfrom\s+'[^']*'/.test(body) || /\brequire\s*\(/.test(body) || /\bexport\b/.test(body)) {
    throw new Error(RE_ANCHOR);
  }

  let factory;
  try {
    // eslint-disable-next-line no-new-func
    factory = new Function(
      'Meteor', 'Session', 'CSAF', 'Companies', 'Roles', 'extractTlp',
      body + '\nreturn {create: typeof create === "function" ? create : null, roles: typeof CSAF_CREATE_ROLES === "undefined" ? null : CSAF_CREATE_ROLES};'
    );
  } catch (e) {
    throw new Error(RE_ANCHOR + ' (compile failed: ' + e.message + ')');
  }
  return factory;
}

const LIVE_SOURCE = read(CREATE_JS);
const LIVE_FACTORY = compileFrom(LIVE_SOURCE);

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

class FakeMeteorError extends Error {
  constructor(error, reason) {
    super('[' + error + '] ' + reason);
    this.error = error;
    this.reason = reason;
  }
}

// `opts.ddpUser`   - what Meteor.userAsync() resolves to (null = no DDP session)
// `opts.granted`   - what Roles.userIsInRole resolves to
// `opts.companies` - the Companies rows findOneAsync can return
// `opts.sessionCompany` - what Session.get('company') returns IN THE BROWSER.
//   Omit the key entirely for the SERVER shape, where `Session` itself is
//   undefined because meteor/session is a client-only package.
function harness(opts) {
  const options = opts || {};
  const log = {
    inserts: [],
    calls: [],
    roleChecks: [],
    companyLookups: [],
    sessionReads: [],
    userAsyncCalls: 0
  };

  const Meteor = {
    Error: FakeMeteorError,
    userAsync: async function () {
      log.userAsyncCalls++;
      return options.ddpUser || null;
    },
    callAsync: async function (name, ...args) {
      log.calls.push({name, args});
      return true;
    }
  };
  const CSAF = {
    insertAsync: async function (doc) {
      log.inserts.push(doc);
      return 'csaf-inserted-id';
    }
  };
  const Companies = {
    findOneAsync: async function (id) {
      log.companyLookups.push(id);
      return (options.companies || {})[id] || null;
    }
  };
  const Roles = {
    userIsInRole: async function (userId, roles, scope) {
      log.roleChecks.push({userId, roles, scope});
      return options.granted !== false;
    }
  };
  const extractTlp = function () {
    return 'WHITE';
  };

  // Session is `undefined` on the server (meteor/session is a client package),
  // which is the branch that matters here: the interactor then resolves the
  // company row itself from the tenant it derived. Pass `sessionCompany` for the
  // BROWSER shape instead - this interactor runs there too, because
  // csaf-import-modal.js imports and calls it directly rather than over DDP.
  let Session;
  if (Object.prototype.hasOwnProperty.call(options, 'sessionCompany')) {
    Session = {
      get: function (key) {
        log.sessionReads.push(key);
        return key === 'company' ? options.sessionCompany : undefined;
      }
    };
  }

  const built = (options.factory || LIVE_FACTORY)(Meteor, Session, CSAF, Companies, Roles, extractTlp);
  if (!built.create) {
    throw new Error(RE_ANCHOR);
  }
  return {create: built.create, roles: built.roles, log};
}

const ATTACKER = {_id: 'u-attacker', profile: {companyId: 'co-attacker'}};
const FORGED_VICTIM = {_id: 'u-forged', profile: {companyId: 'co-victim'}};
const REST_PRINCIPAL = {_id: 'u-rest', profile: {companyId: 'co-rest'}};

const COMPANIES = {
  'co-attacker': {_id: 'co-attacker', providerId: 'prov-attacker'},
  'co-victim': {_id: 'co-victim', providerId: 'prov-victim'},
  'co-rest': {_id: 'co-rest', providerId: 'prov-rest'}
};

const FILE = {document: {category: 'csaf_vex', title: 'advisory'}};

async function expectReject(promise) {
  let thrown = null;
  try {
    await promise;
  } catch (e) {
    thrown = e;
  }
  expect(thrown).not.toBeNull();
  return thrown;
}

// ---------------------------------------------------------------------------
// 0. The lift reads live source (non-vacuity for everything below)
// ---------------------------------------------------------------------------

describe('the interactor under test is the real, live create.js', () => {
  const live = stripComments(LIVE_SOURCE);

  it('compiles to a callable create', () => {
    expect(typeof harness({ddpUser: ATTACKER, companies: COMPANIES}).create).toBe('function');
  });

  it('the live source really resolves the DDP principal and really inserts', () => {
    expect(live).toContain('Meteor.userAsync()');
    expect(live).toContain('CSAF.insertAsync(');
  });

  it('the live source really consults Roles.userIsInRole', () => {
    expect(live).toContain('Roles.userIsInRole(');
  });

  it('refuses to run against a module whose linkage no longer strips (re-anchor guard)', () => {
    expect(() => compileFrom("import x from 'y'\nconst create = 1;")).toThrow(/re-anchored/);
  });

  it('refuses to run against a module with no create function (re-anchor guard)', () => {
    const gutted = LIVE_SOURCE.replace(/const create = async function/, 'const notCreate = async function');
    expect(() => harness({factory: compileFrom(gutted)})).toThrow(/re-anchored/);
  });
});

// ---------------------------------------------------------------------------
// 1. The tenant comes from the authenticated principal, never from a client arg
// ---------------------------------------------------------------------------

describe('the target tenant is derived from the authenticated principal', () => {
  it('a forged apiUser does NOT redirect the write when a DDP session exists', async () => {
    const h = harness({ddpUser: ATTACKER, companies: COMPANIES});
    await h.create({file: FILE, name: 'x.json', apiUser: FORGED_VICTIM});

    expect(h.log.inserts).toHaveLength(1);
    expect(h.log.inserts[0].companyId).toBe('co-attacker');
    expect(h.log.inserts[0].companyId).not.toBe('co-victim');
  });

  it('never even reads the forged company row', async () => {
    const h = harness({ddpUser: ATTACKER, companies: COMPANIES});
    await h.create({file: FILE, name: 'x.json', apiUser: FORGED_VICTIM});

    expect(h.log.companyLookups).not.toContain('co-victim');
    expect(h.log.companyLookups).toContain('co-attacker');
  });

  it('derives providerId from the authenticated company, not the forged one', async () => {
    const h = harness({ddpUser: ATTACKER, companies: COMPANIES});
    await h.create({file: FILE, name: 'x.json', apiUser: FORGED_VICTIM});

    expect(h.log.inserts[0].providerId).toBe('prov-attacker');
    expect(h.log.inserts[0].providerId).not.toBe('prov-victim');
  });

  it('attributes the logEvent to the DDP principal, not the forged one', async () => {
    const h = harness({ddpUser: ATTACKER, companies: COMPANIES});
    await h.create({file: FILE, name: 'x.json', apiUser: FORGED_VICTIM});

    const logEvents = h.log.calls.filter((c) => c.name === 'logEvent');
    expect(logEvents).toHaveLength(1);
    expect(logEvents[0].args[0]).toBe(ATTACKER);
    expect(logEvents[0].args[0]).not.toBe(FORGED_VICTIM);
    expect(logEvents[0].args[2]).toBe('csafCreated');
  });

  it('resolves the DDP session before it ever looks at apiUser', async () => {
    const h = harness({ddpUser: ATTACKER, companies: COMPANIES});
    await h.create({file: FILE, name: 'x.json', apiUser: FORGED_VICTIM});

    expect(h.log.userAsyncCalls).toBeGreaterThan(0);
  });

  it('would FAIL under the apiUser-first ordering this replaced (non-vacuity)', async () => {
    const sabotaged = LIVE_SOURCE.replace(
      /let user = await Meteor\.userAsync\(\);/,
      'let user = apiUser || await Meteor.userAsync();'
    );
    expect(sabotaged).not.toBe(LIVE_SOURCE);

    const h = harness({factory: compileFrom(sabotaged), ddpUser: ATTACKER, companies: COMPANIES});
    await h.create({file: FILE, name: 'x.json', apiUser: FORGED_VICTIM});

    // The exact cross-tenant write the fix closes.
    expect(h.log.inserts[0].companyId).toBe('co-victim');
  });
});

// ---------------------------------------------------------------------------
// 2. The client-supplied companyId argument stays ignored
// ---------------------------------------------------------------------------

describe('the client-supplied companyId argument is ignored', () => {
  it('a companyId argument cannot steer the write', async () => {
    const h = harness({ddpUser: ATTACKER, companies: COMPANIES});
    await h.create({file: FILE, companyId: 'co-victim', name: 'x.json'});

    expect(h.log.inserts[0].companyId).toBe('co-attacker');
    expect(h.log.companyLookups).not.toContain('co-victim');
  });

  it('a companyId argument cannot steer the write even alongside a forged apiUser', async () => {
    const h = harness({ddpUser: ATTACKER, companies: COMPANIES});
    await h.create({file: FILE, companyId: 'co-victim', name: 'x.json', apiUser: FORGED_VICTIM});

    expect(h.log.inserts[0].companyId).toBe('co-attacker');
  });

  it('create does not destructure companyId out of its argument object', () => {
    const live = stripComments(LIVE_SOURCE);
    const signature = /const create = async function \(\{([^}]*)\}\)/.exec(live);
    if (!signature) {
      throw new Error(RE_ANCHOR);
    }
    const params = signature[1].split(',').map((s) => s.trim()).filter(Boolean);
    // positive anchor first: the parameters this really does take
    expect(params).toContain('file');
    expect(params).toContain('name');
    expect(params).toContain('apiUser');
    expect(params).not.toContain('companyId');
  });

  it('vex.js still sends the companyId the interactor ignores (documents the gap, not a contract)', () => {
    // Recorded so the "already ignored" claim is checked against the caller
    // rather than assumed. If this ever stops matching, the assertion above is
    // the one that matters - this one only describes the wire.
    expect(stripComments(read(VEX_JS))).toMatch(/Meteor\.call\('CSAF\.Create',\s*\{[^}]*companyId/);
  });
});

// ---------------------------------------------------------------------------
// 3. The server-side role check
// ---------------------------------------------------------------------------

describe('a role check is enforced for DDP principals', () => {
  it('consults Roles.userIsInRole with the principal id and the principal company as scope', async () => {
    const h = harness({ddpUser: ATTACKER, companies: COMPANIES});
    await h.create({file: FILE, name: 'x.json'});

    expect(h.log.roleChecks).toHaveLength(1);
    expect(h.log.roleChecks[0].userId).toBe('u-attacker');
    expect(h.log.roleChecks[0].scope).toBe('co-attacker');
  });

  it('scopes the role check to the principal company, never to a supplied one', async () => {
    const h = harness({ddpUser: ATTACKER, companies: COMPANIES});
    await h.create({file: FILE, companyId: 'co-victim', name: 'x.json', apiUser: FORGED_VICTIM});

    expect(h.log.roleChecks[0].scope).toBe('co-attacker');
    expect(h.log.roleChecks[0].scope).not.toBe('co-victim');
  });

  it('throws 403 and inserts nothing when the principal holds none of the roles', async () => {
    const h = harness({ddpUser: ATTACKER, granted: false, companies: COMPANIES});
    const err = await expectReject(h.create({file: FILE, name: 'x.json'}));

    expect(err.error).toBe(403);
    expect(h.log.inserts).toHaveLength(0);
  });

  it('logs no event when the role check refuses', async () => {
    const h = harness({ddpUser: ATTACKER, granted: false, companies: COMPANIES});
    await expectReject(h.create({file: FILE, name: 'x.json'}));

    expect(h.log.calls.filter((c) => c.name === 'logEvent')).toHaveLength(0);
  });

  it('refuses before it touches the file, so a role-less caller cannot probe with a bad payload', async () => {
    const h = harness({ddpUser: ATTACKER, granted: false, companies: COMPANIES});
    const err = await expectReject(h.create({name: 'x.json'}));

    expect(err.error).toBe(403);
  });

  it('checks exactly the four roles that can legitimately create a CSAF today', async () => {
    const h = harness({ddpUser: ATTACKER, companies: COMPANIES});
    await h.create({file: FILE, name: 'x.json'});

    const roles = h.log.roleChecks[0].roles;
    expect(Array.isArray(roles)).toBe(true);
    // The union of the two sets that guarded creation before the fix:
    //   csaf/update.js + csaf/remove.js -> compliance_manager, company_security_manager, account_admin
    //   the client-side Create CSAF gate -> manager, company_security_manager
    expect([...roles].sort()).toEqual(
      ['account_admin', 'company_security_manager', 'compliance_manager', 'manager']
    );
  });

  it('grants none of the roles the union deliberately leaves out', async () => {
    const h = harness({ddpUser: ATTACKER, companies: COMPANIES});
    await h.create({file: FILE, name: 'x.json'});

    const roles = h.log.roleChecks[0].roles;
    ['developer', 'portfolio_manager',
      'company_component_manager', 'admin'].forEach((role) => {
      expect(roles).not.toContain(role);
    });
  });

  it('exposes the set as one named constant so no caller re-derives it', () => {
    const h = harness({ddpUser: ATTACKER, companies: COMPANIES});
    expect(Array.isArray(h.roles)).toBe(true);
    expect([...h.roles].sort()).toEqual(
      ['account_admin', 'company_security_manager', 'compliance_manager', 'manager']
    );
  });

  it('the constant is the array the check actually consults, not a parallel copy', async () => {
    const h = harness({ddpUser: ATTACKER, companies: COMPANIES});
    await h.create({file: FILE, name: 'x.json'});

    expect(h.log.roleChecks[0].roles).toBe(h.roles);
  });

  it('would FAIL with no role check at all (non-vacuity)', async () => {
    // Short-circuit the role term out of the guard's condition, so the check is
    // never even called - the pre-fix state. Anchored on the negated call rather
    // than on the whole if-block, so a reshaped condition re-anchors loudly here
    // instead of quietly neutering this sabotage.
    const ANCHOR = '!await Roles.userIsInRole(';
    if (stripComments(LIVE_SOURCE).indexOf(ANCHOR) === -1) {
      throw new Error(RE_ANCHOR + ' (no `!await Roles.userIsInRole(` guard term found)');
    }
    const sabotaged = LIVE_SOURCE.replace(ANCHOR, 'false && ' + ANCHOR);
    expect(sabotaged).not.toBe(LIVE_SOURCE);

    const h = harness({factory: compileFrom(sabotaged), ddpUser: ATTACKER, granted: false, companies: COMPANIES});
    await h.create({file: FILE, name: 'x.json'});

    // Without the guard a role-less principal writes a CSAF - which is the
    // pre-fix behaviour, and what the assertions above exist to prevent.
    expect(h.log.roleChecks).toHaveLength(0);
    expect(h.log.inserts).toHaveLength(1);
  });

  it('would FAIL if a role were dropped from or added to the set (non-vacuity)', async () => {
    const sabotaged = LIVE_SOURCE.replace(/'manager'/, "'developer'");
    expect(sabotaged).not.toBe(LIVE_SOURCE);

    const h = harness({factory: compileFrom(sabotaged), ddpUser: ATTACKER, companies: COMPANIES});
    await h.create({file: FILE, name: 'x.json'});

    expect([...h.log.roleChecks[0].roles].sort()).not.toEqual(
      ['account_admin', 'company_security_manager', 'compliance_manager', 'manager']
    );
  });
});

// ---------------------------------------------------------------------------
// 4. The apiUser path (no DDP session) still works
// ---------------------------------------------------------------------------

describe('the apiUser path survives - it is the only principal a REST/server-internal call has', () => {
  it('with no DDP session the apiUser supplies the principal and the tenant', async () => {
    const h = harness({ddpUser: null, companies: COMPANIES});
    const id = await h.create({file: FILE, name: 'x.json', apiUser: REST_PRINCIPAL});

    expect(id).toBe('csaf-inserted-id');
    expect(h.log.inserts).toHaveLength(1);
    expect(h.log.inserts[0].companyId).toBe('co-rest');
    expect(h.log.inserts[0].providerId).toBe('prov-rest');
  });

  it('consults no role check on the apiUser path, exactly like csaf/update.js', async () => {
    const h = harness({ddpUser: null, granted: false, companies: COMPANIES});
    await h.create({file: FILE, name: 'x.json', apiUser: REST_PRINCIPAL});

    expect(h.log.roleChecks).toHaveLength(0);
    expect(h.log.inserts).toHaveLength(1);
  });

  it('attributes the logEvent to the apiUser on that path', async () => {
    const h = harness({ddpUser: null, companies: COMPANIES});
    await h.create({file: FILE, name: 'x.json', apiUser: REST_PRINCIPAL});

    const logEvents = h.log.calls.filter((c) => c.name === 'logEvent');
    expect(logEvents[0].args[0]).toBe(REST_PRINCIPAL);
  });

  it('the apiUser parameter is still accepted, so no REST/server-internal caller loses its principal', () => {
    expect(stripComments(LIVE_SOURCE)).toMatch(/const create = async function \(\{[^}]*apiUser[^}]*\}\)/);
  });

  it('csaf/createOrUpdate.js still forwards an apiUser into create', () => {
    // createOrUpdate passes `apiUser || user`, so with the DDP-first ordering in
    // create a forged third argument to CSAF.CreateOrUpdate is inert too.
    expect(stripComments(read(CREATE_OR_UPDATE_JS))).toMatch(/create\(\{[^}]*apiUser/);
  });

  it('with neither a DDP session nor an apiUser, 403 and nothing written', async () => {
    const h = harness({ddpUser: null, companies: COMPANIES});
    const err = await expectReject(h.create({file: FILE, name: 'x.json'}));

    expect(err.error).toBe(403);
    expect(h.log.inserts).toHaveLength(0);
  });

  it('a principal carrying no profile.companyId is refused, not written as undefined', async () => {
    const h = harness({ddpUser: null, companies: COMPANIES});
    const err = await expectReject(
      h.create({file: FILE, name: 'x.json', apiUser: {_id: 'u-noprofile'}})
    );

    expect(err.error).toBe(403);
    expect(h.log.inserts).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 5. The shape follows csaf/update.js, the sibling that already got it right
// ---------------------------------------------------------------------------

describe('create.js follows the ordering csaf/update.js already uses', () => {
  const createLive = stripComments(LIVE_SOURCE);
  const updateLive = stripComments(read(UPDATE_JS));

  it('update.js still resolves the DDP principal first (the template did not move)', () => {
    const body = updateLive.slice(updateLive.indexOf('const update = async function'));
    expect(body).toMatch(/let user = await Meteor\.userAsync\(\);/);
    // past the signature, which names apiUser as a positional parameter
    const afterSig = body.slice(body.indexOf('{'));
    expect(afterSig.indexOf('Meteor.userAsync()')).toBeLessThan(afterSig.indexOf('apiUser'));
  });

  it('create.js resolves the DDP principal before it reads apiUser', () => {
    // Shape-agnostic: inside the function BODY (past the destructured
    // signature, which necessarily names apiUser first) the statement that
    // reads the session must come before the first use of the client-supplied
    // fallback, whatever the branch around it looks like.
    const decl = createLive.indexOf('const create = async function');
    const sigEnd = createLive.indexOf('{', createLive.indexOf('})', decl));
    if (decl === -1 || sigEnd === -1) {
      throw new Error(RE_ANCHOR);
    }
    const body = createLive.slice(sigEnd);
    expect(body).toMatch(/let user = await Meteor\.userAsync\(\);/);
    expect(body).toContain('apiUser');
    expect(body.indexOf('Meteor.userAsync()')).toBeLessThan(body.indexOf('apiUser'));
  });

  it('create.js no longer contains the apiUser-first expression', () => {
    expect(createLive).not.toMatch(/apiUser\s*\|\|\s*await Meteor\.userAsync\(\)/);
  });
});

// ---------------------------------------------------------------------------
// 6. Behaviour that must not regress
// ---------------------------------------------------------------------------

describe('the rest of the interactor is unchanged', () => {
  it('a missing file is still a 400 for an authorised principal', async () => {
    const h = harness({ddpUser: ATTACKER, companies: COMPANIES});
    const err = await expectReject(h.create({name: 'x.json'}));

    expect(err.error).toBe(400);
    expect(h.log.inserts).toHaveLength(0);
  });

  it('stores the document as a DRAFT with the name, tlp and category it was given', async () => {
    const h = harness({ddpUser: ATTACKER, companies: COMPANIES});
    await h.create({file: FILE, name: 'advisory.json'});

    const doc = h.log.inserts[0];
    expect(doc.status).toBe('DRAFT');
    expect(doc.name).toBe('advisory.json');
    expect(doc.tlp).toBe('WHITE');
    expect(doc.category).toBe('csaf_vex');
    expect(doc.data).toBe(JSON.stringify(FILE));
    expect(doc.submitted).toBeInstanceOf(Date);
  });

  it('returns the inserted id', async () => {
    const h = harness({ddpUser: ATTACKER, companies: COMPANIES});
    expect(await h.create({file: FILE, name: 'x.json'})).toBe('csaf-inserted-id');
  });

  it('falls back to the tenant id for providerId when the company row is missing', async () => {
    // The tenant is authenticated but its Companies row cannot be read; the
    // interactor must still produce a defined providerId rather than throw.
    const h = harness({ddpUser: ATTACKER, companies: {}});
    await h.create({file: FILE, name: 'x.json'});

    expect(h.log.inserts).toHaveLength(1);
    expect(h.log.inserts[0].providerId).toBe('co-attacker');
  });
});

// ---------------------------------------------------------------------------
// 7. providerId names the same tenant the document is written to
// ---------------------------------------------------------------------------
//
// `companyId` is the tenant key and is enforced: CSAF.allow only lets a client
// insert a doc whose companyId is its own company. `providerId` is enforced by
// NOTHING - it is stamped here and later spent by ts-csaf.js, which builds the
// SSM parameter path `/csaf/<providerId>/provider/passphrase` and the published
// feed URL out of it. So the two fields have to name the same tenant.
//
// They could disagree: the company document was resolved from the browser's
// `Session` cache FIRST and only fell back to the tenant derived from the
// authenticated principal. Session is client state - it can be stale, or hold a
// different company after a switch - so a document could be written into the
// correct tenant while carrying another tenant's providerId.
//
// The cache still has a job on the client: this interactor runs in the BROWSER
// for the CSAF import modal, and the /csaf route (router.js `csafList`) does not
// subscribe to `company`, so minimongo holds no Companies row there. The cached
// document is the only place the browser can read providerId from. It is kept -
// but only when it IS the authenticated tenant.

// A different company than the authenticated principal's.
const SESSION_FOREIGN = {_id: 'co-victim', providerId: 'prov-victim'};
// The authenticated tenant, but deliberately carrying a DIFFERENT providerId
// than the co-attacker row in COMPANIES, so "the cached doc was used" and "the
// row was fetched" are distinguishable rather than both spelling prov-attacker.
const SESSION_OWN = {_id: 'co-attacker', providerId: 'prov-attacker-cached'};

describe('a Session holding another company cannot decide providerId', () => {
  it('stamps the authenticated tenant providerId, not the one the Session holds', async () => {
    const h = harness({ddpUser: ATTACKER, sessionCompany: SESSION_FOREIGN, companies: COMPANIES});
    await h.create({file: FILE, name: 'x.json'});

    expect(h.log.inserts[0].providerId).toBe('prov-attacker');
    expect(h.log.inserts[0].providerId).not.toBe('prov-victim');
  });

  it('keeps providerId and companyId naming the same tenant', async () => {
    const h = harness({ddpUser: ATTACKER, sessionCompany: SESSION_FOREIGN, companies: COMPANIES});
    await h.create({file: FILE, name: 'x.json'});

    const doc = h.log.inserts[0];
    expect(doc.companyId).toBe('co-attacker');
    expect(doc.providerId).toBe(COMPANIES[doc.companyId].providerId);
  });

  it('resolves the company row for the authenticated tenant instead of trusting the cache', async () => {
    const h = harness({ddpUser: ATTACKER, sessionCompany: SESSION_FOREIGN, companies: COMPANIES});
    await h.create({file: FILE, name: 'x.json'});

    expect(h.log.companyLookups).toContain('co-attacker');
    expect(h.log.companyLookups).not.toContain('co-victim');
  });

  it('a foreign Session cannot supply providerId even when the tenant row is missing', async () => {
    // The b42c538fc fallback still has to win here: a defined providerId that
    // names the right tenant, never the readable-but-wrong cached one.
    const h = harness({ddpUser: ATTACKER, sessionCompany: SESSION_FOREIGN, companies: {}});
    await h.create({file: FILE, name: 'x.json'});

    expect(h.log.inserts).toHaveLength(1);
    expect(h.log.inserts[0].providerId).toBe('co-attacker');
    expect(h.log.inserts[0].providerId).not.toBe('prov-victim');
  });

  it('a cached document carrying no _id is not trusted', async () => {
    const h = harness({
      ddpUser: ATTACKER,
      sessionCompany: {providerId: 'prov-nowhere'},
      companies: COMPANIES
    });
    await h.create({file: FILE, name: 'x.json'});

    expect(h.log.inserts[0].providerId).toBe('prov-attacker');
    expect(h.log.companyLookups).toContain('co-attacker');
  });

  it('a non-object Session value is not trusted and does not throw', async () => {
    // getCompanyCurrent returns `false` for a profile-less user, and the key can
    // hold whatever a previous Session.set left there.
    const h = harness({ddpUser: ATTACKER, sessionCompany: 'co-victim', companies: COMPANIES});
    await h.create({file: FILE, name: 'x.json'});

    expect(h.log.inserts[0].providerId).toBe('prov-attacker');
  });

  it('an empty Session key falls through to the company row', async () => {
    const h = harness({ddpUser: ATTACKER, sessionCompany: undefined, companies: COMPANIES});
    await h.create({file: FILE, name: 'x.json'});

    expect(h.log.inserts[0].providerId).toBe('prov-attacker');
    expect(h.log.companyLookups).toContain('co-attacker');
  });

  it('a foreign Session cannot supply providerId on the apiUser path either', async () => {
    const h = harness({ddpUser: null, sessionCompany: SESSION_FOREIGN, companies: COMPANIES});
    await h.create({file: FILE, name: 'x.json', apiUser: REST_PRINCIPAL});

    expect(h.log.inserts[0].companyId).toBe('co-rest');
    expect(h.log.inserts[0].providerId).toBe('prov-rest');
  });

  it('a foreign Session cannot steer the write alongside a forged apiUser', async () => {
    const h = harness({ddpUser: ATTACKER, sessionCompany: SESSION_FOREIGN, companies: COMPANIES});
    await h.create({file: FILE, name: 'x.json', apiUser: FORGED_VICTIM});

    expect(h.log.inserts[0].companyId).toBe('co-attacker');
    expect(h.log.inserts[0].providerId).toBe('prov-attacker');
  });

  it('would FAIL under the Session-first resolution this replaced (non-vacuity)', async () => {
    // Neutralise the term that ties the cached document to the derived tenant,
    // which restores "whatever Session holds wins". Anchored on that term rather
    // than on the whole statement, so a reshaped resolution re-anchors loudly
    // here instead of quietly neutering the sabotage.
    const ANCHOR = 'cachedCompany._id === companyIdentifier';
    if (stripComments(LIVE_SOURCE).indexOf(ANCHOR) === -1) {
      throw new Error(RE_ANCHOR + ' (no cached-company/tenant agreement term found)');
    }
    const sabotaged = LIVE_SOURCE.replace(ANCHOR, 'true');
    expect(sabotaged).not.toBe(LIVE_SOURCE);

    const h = harness({
      factory: compileFrom(sabotaged),
      ddpUser: ATTACKER,
      sessionCompany: SESSION_FOREIGN,
      companies: COMPANIES
    });
    await h.create({file: FILE, name: 'x.json'});

    // The exact disagreement this section closes: written into co-attacker,
    // stamped with co-victim's provider.
    expect(h.log.inserts[0].companyId).toBe('co-attacker');
    expect(h.log.inserts[0].providerId).toBe('prov-victim');
  });
});

describe('the browser cache is still used, but only for the authenticated tenant', () => {
  it('uses the cached document when it IS the authenticated tenant', async () => {
    const h = harness({ddpUser: ATTACKER, sessionCompany: SESSION_OWN, companies: COMPANIES});
    await h.create({file: FILE, name: 'x.json'});

    expect(h.log.inserts[0].providerId).toBe('prov-attacker-cached');
  });

  it('spends no company round trip on that path', async () => {
    // Why the cache is worth keeping: on /csaf the browser has no Companies row
    // to read, so dropping it would downgrade every browser-side import to the
    // companyIdentifier fallback.
    const h = harness({ddpUser: ATTACKER, sessionCompany: SESSION_OWN, companies: COMPANIES});
    await h.create({file: FILE, name: 'x.json'});

    expect(h.log.companyLookups).toHaveLength(0);
    expect(h.log.sessionReads).toContain('company');
  });

  it('does not let the cache change the tenant the document is written to', async () => {
    const h = harness({ddpUser: ATTACKER, sessionCompany: SESSION_OWN, companies: COMPANIES});
    await h.create({file: FILE, name: 'x.json'});

    expect(h.log.inserts[0].companyId).toBe('co-attacker');
  });

  it('reads no Session at all on the server, where the binding is undefined', async () => {
    const h = harness({ddpUser: ATTACKER, companies: COMPANIES});
    await h.create({file: FILE, name: 'x.json'});

    expect(h.log.sessionReads).toHaveLength(0);
    expect(h.log.companyLookups).toContain('co-attacker');
    expect(h.log.inserts[0].providerId).toBe('prov-attacker');
  });

  it('would FAIL if the cache were dropped rather than validated (non-vacuity)', async () => {
    // Deleting the Session read outright also makes providerId agree with the
    // tenant - but it costs the browser its only source for providerId. This
    // pins the fast path so that "fix" cannot land unnoticed.
    const sabotaged = LIVE_SOURCE.replace(
      /const cachedCompany = [^\n]*\n/,
      'const cachedCompany = null;\n'
    );
    expect(sabotaged).not.toBe(LIVE_SOURCE);

    const h = harness({
      factory: compileFrom(sabotaged),
      ddpUser: ATTACKER,
      sessionCompany: SESSION_OWN,
      companies: {}
    });
    await h.create({file: FILE, name: 'x.json'});

    // No cache, no published Companies row on /csaf: providerId degrades to the
    // bare tenant id instead of the real provider.
    expect(h.log.inserts[0].providerId).toBe('co-attacker');
  });
});
