/* eslint-disable no-undef */
// ---------------------------------------------------------------------------
// The CWE-mapping write path, executed rather than described.
//
// What this closes.
//
// `5752c1f5b harden(cwe-mappings)` is titled "close every route between a
// mapping and another tenant", and the four specs that shipped with the feature
// test only the pure overlay modules (`cweMappingOverlay.js`, `cweExtract.js`).
// The three interactors that actually write and read the collection -
// set.js / remove.js / findForCompany.js - had no Jest coverage at all. The only
// executable check on them is `tools/security/regress-tenant.mjs`, which needs a
// live dev server, two real tenants in different companies and a
// company_security_manager password; it skips silently otherwise and never runs
// in CI. So the tenancy claim in the commit message was unverified on every
// commit.
//
// The invariants under test are the ones a cross-tenant bug would break:
//   1. the company is taken from the CALLER, never from the arguments;
//   2. a non-string company short-circuits BEFORE any query, because
//      `{companyId: {$ne: null}}` in a selector reads every tenant at once;
//   3. every selector that reaches the collection carries that company;
//   4. a global default (companyId absent) is not reachable from ts-app;
//   5. findForCompany publishes the overlay's four fields and no curator name.
//
// Plus the DDP retry invariant: Meteor re-sends an outstanding
// method call on reconnect, so `CweMappings.Set` runs twice for one assignment.
// The second run must land as an update, not a duplicate row or an error.
//
// The three interactors import Meteor, so they are loaded through the repo's
// `loadMeteorModule` helper - the real shipped source runs, with its imports
// swapped for recording stubs. `normalizeCwe`, `normalizeTool` and
// `CWE_MAPPING_WRITE_ROLES` are injected REAL, not faked: a spec-local copy of
// the id normaliser would assert nothing about what is stored.
// ---------------------------------------------------------------------------
const {loadMeteorModule, readSourceWithoutComments} = require('../helpers/loadMeteorModule');
const {normalizeCwe} = require('../../imports/lib/sarif/cweExtract');
// The whole module, not a hand-picked slice: set.js and remove.js also read the
// shared write bounds (CWE_MAPPING_MAX_CWES and friends) from here, and a stub
// that omitted them would silently make every length check reject everything.
const overlay = require('../../imports/lib/sarif/cweMappingOverlay');
const {normalizeTool, indexMappings, mappedCwesForRule} = overlay;
const {CWE_MAPPING_WRITE_ROLES} = require('../../imports/lib/interactors/cweMappings/roles');

const SET_JS = 'imports/lib/interactors/cweMappings/set.js';
const REMOVE_JS = 'imports/lib/interactors/cweMappings/remove.js';
const FIND_JS = 'imports/lib/interactors/cweMappings/findForCompany.js';

const CALLER_CO = 'company-caller';
const VICTIM_CO = 'company-victim';
const RULE = 'python.lang.security.audit.eval-detected';

// --- a recording stand-in for the collection -------------------------------

// Selector values are asserted to be primitives. An operator object reaching a
// selector - `{$ne: ''}`, `{$exists: true}`, `{$gt: ''}` - is precisely how a
// tenant-scoped query turns into a cross-tenant one, so it fails loudly here
// instead of quietly matching every document in the fake store.
function assertPrimitive(field, value) {
  if (value !== null && typeof value === 'object') {
    throw new Error(
      `cweMappings selector field '${field}' received an object (${JSON.stringify(value)}); ` +
      'a Mongo operator here widens the query across tenants');
  }
}

function matchSelector(doc, selector) {
  if (typeof selector === 'string') {
    return doc._id === selector;
  }
  if (!selector || typeof selector !== 'object') {
    return false;
  }
  if (Array.isArray(selector.$or)) {
    return selector.$or.some((branch) => matchSelector(doc, branch));
  }
  return Object.keys(selector).every((field) => {
    const wanted = selector[field];
    assertPrimitive(field, wanted);
    // Mongo's `{companyId: null}` matches both an explicit null and an absent
    // field - the behaviour the publication and findForCompany rely on to reach
    // a global default written either way.
    if (wanted === null) {
      return doc[field] === null || doc[field] === undefined;
    }
    return doc[field] === wanted;
  });
}

function project(doc, fields) {
  if (!fields) {
    return Object.assign({}, doc);
  }
  const out = {_id: doc._id};
  Object.keys(fields).forEach((field) => {
    if (fields[field] && Object.prototype.hasOwnProperty.call(doc, field)) {
      out[field] = doc[field];
    }
  });
  return out;
}

/**
 * @param {object} [options]
 *   docs             seed documents
 *   user             the caller (null = signed out)
 *   grantRole        what Roles.userIsInRole resolves to
 *   blindFindOne     make the next N findOneAsync calls miss, simulating the
 *                    concurrent-retry race the unique index exists to catch
 */
function world(options) {
  const opts = options || {};
  const docs = (opts.docs || []).map((doc) => Object.assign({}, doc));
  const log = [];
  const events = [];
  const roleChecks = [];
  let blind = opts.blindFindOne || 0;
  let nextId = 0;

  function MeteorError(error, reason) {
    this.error = error;
    this.reason = reason;
    this.message = reason + ' [' + error + ']';
  }
  MeteorError.prototype = Object.create(Error.prototype);
  MeteorError.prototype.name = 'Meteor.Error';

  const CweMappings = {
    findOneAsync: async function (selector, findOptions) {
      log.push({op: 'findOne', selector, options: findOptions});
      const hit = docs.find((doc) => matchSelector(doc, selector)) || null;
      if (blind > 0) {
        blind -= 1;
        return null;
      }
      return hit;
    },
    insertAsync: async function (doc) {
      log.push({op: 'insert', doc: Object.assign({}, doc)});
      // The shipped unique index: {companyId: 1, tool: 1, ruleId: 1}.
      const clash = docs.some((stored) => stored.companyId === doc.companyId &&
        stored.tool === doc.tool && stored.ruleId === doc.ruleId);
      if (clash) {
        const error = new Error('E11000 duplicate key error collection: ts.cweMappings ' +
          'index: companyId_1_tool_1_ruleId_1');
        error.code = 11000;
        throw error;
      }
      nextId += 1;
      const stored = Object.assign({_id: 'map-' + nextId}, doc);
      docs.push(stored);
      return stored._id;
    },
    updateAsync: async function (selector, modifier) {
      log.push({op: 'update', selector, modifier});
      const hits = docs.filter((doc) => matchSelector(doc, selector));
      hits.forEach((doc) => Object.assign(doc, modifier.$set));
      return hits.length;
    },
    removeAsync: async function (selector) {
      log.push({op: 'remove', selector});
      const hits = docs.filter((doc) => matchSelector(doc, selector));
      hits.forEach((doc) => docs.splice(docs.indexOf(doc), 1));
      return hits.length;
    },
    find: function (selector, findOptions) {
      log.push({op: 'find', selector, options: findOptions});
      return {
        // Meteor 3 made the synchronous cursor API client-only. A regression
        // back to fetch() on the server must surface as a failure here rather
        // than as a silently empty mapping set in production.
        fetch: function () {
          throw new Error('CweMappings.find().fetch() is client-only in Meteor 3 - use fetchAsync()');
        },
        fetchAsync: async function () {
          return docs.filter((doc) => matchSelector(doc, selector))
            .map((doc) => project(doc, findOptions && findOptions.fields));
        }
      };
    }
  };

  const Meteor = {
    Error: MeteorError,
    isClient: false,
    isServer: true,
    userAsync: async function () {
      return Object.prototype.hasOwnProperty.call(opts, 'user') ? opts.user : defaultUser();
    },
    callAsync: async function (name) {
      events.push({name, args: Array.prototype.slice.call(arguments, 1)});
      return null;
    }
  };

  const Roles = {
    userIsInRole: async function (userId, roles, group) {
      roleChecks.push({userId, roles, group});
      return opts.grantRole === undefined ? true : opts.grantRole;
    }
  };

  const deps = {
    'meteor/meteor': {Meteor},
    'meteor/alanning:roles': {Roles},
    '/imports/lib/collections/cweMappings': CweMappings,
    '/imports/lib/sarif/cweExtract': {normalizeCwe},
    '/imports/lib/sarif/cweMappingOverlay': overlay,
    './roles': {CWE_MAPPING_WRITE_ROLES}
  };

  return {
    docs,
    log,
    events,
    roleChecks,
    set: loadMeteorModule(SET_JS, deps).default,
    remove: loadMeteorModule(REMOVE_JS, deps).default,
    findForCompany: loadMeteorModule(FIND_JS, {
      '/imports/lib/collections/cweMappings': CweMappings
    }).default
  };
}

function defaultUser() {
  return {
    _id: 'user-1',
    profile: {companyId: CALLER_CO, name: 'Sec Manager'},
    emails: [{address: 'sec@caller.example'}]
  };
}

// Every selector, insert document and update selector that reached the
// collection, so a single assertion can sweep the whole conversation.
function tenantsTouched(log) {
  const seen = new Set();
  log.forEach((entry) => {
    const carriers = [entry.selector, entry.doc, entry.modifier && entry.modifier.$set];
    carriers.forEach((carrier) => {
      if (carrier && typeof carrier === 'object' && 'companyId' in carrier) {
        seen.add(String(carrier.companyId));
      }
      if (carrier && Array.isArray(carrier.$or)) {
        carrier.$or.forEach((branch) => seen.add(String(branch.companyId)));
      }
    });
  });
  return seen;
}

async function rejection(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to be refused, but it resolved');
}

// --- the lift really came out of the shipped source ------------------------

describe('the interactors under test are the shipped ones', () => {
  it('lifted set/remove/findForCompany with their tenancy guards intact', () => {
    const setSource = readSourceWithoutComments(SET_JS);
    const removeSource = readSourceWithoutComments(REMOVE_JS);
    const findSource = readSourceWithoutComments(FIND_JS);

    // Comment-stripped, so a guard that was commented out cannot pass as live.
    [setSource, removeSource].forEach((source) => {
      expect(source).toMatch(/typeof user\.profile\.companyId !== 'string'/);
      expect(source).toMatch(/const companyId = user\.profile\.companyId/);
      expect(source).toMatch(/Roles\.userIsInRole\(user\._id, CWE_MAPPING_WRITE_ROLES, companyId\)/);
    });
    expect(findSource).toMatch(/typeof companyId !== 'string'/);
    // Neither write path may read a company out of `params` - that is the field
    // an attacker sets.
    expect(setSource).not.toMatch(/params\s*(&&\s*params)?\.companyId/);
    expect(removeSource).not.toMatch(/params\s*(&&\s*params)?\.companyId/);
  });

  it('exposes the three interactors as callable functions', () => {
    const api = world();
    expect(typeof api.set).toBe('function');
    expect(typeof api.remove).toBe('function');
    expect(typeof api.findForCompany).toBe('function');
  });
});

// --- 1/2/3: the company comes from the caller ------------------------------

describe('#112 CweMappings.Set files an assignment under the caller, never the argument', () => {
  it('ignores a companyId the caller supplies and stores its own', async () => {
    const api = world();
    const result = await api.set({
      tool: 'semgrep', ruleId: RULE, cwes: ['CWE-95'],
      // Every field an attacker would reach for.
      companyId: VICTIM_CO, company: VICTIM_CO, profile: {companyId: VICTIM_CO}
    });

    expect(result).toEqual({tool: 'semgrep', ruleId: RULE, cwes: ['CWE-95']});
    expect(api.docs).toHaveLength(1);
    expect(api.docs[0].companyId).toBe(CALLER_CO);
    // ...and the victim's company never appeared in ANY selector or document,
    // not merely in the one that was stored.
    expect([...tenantsTouched(api.log)]).toEqual([CALLER_CO]);
  });

  it('checks the role against the caller\'s company, not the argument\'s', async () => {
    const api = world();
    await api.set({tool: 'semgrep', ruleId: RULE, cwes: ['CWE-95'], companyId: VICTIM_CO});
    expect(api.roleChecks).toEqual([
      {userId: 'user-1', roles: CWE_MAPPING_WRITE_ROLES, group: CALLER_CO}
    ]);
    // The shared list, not a second copy that could drift from the client guard.
    expect(api.roleChecks[0].roles).toBe(CWE_MAPPING_WRITE_ROLES);
  });

  it('refuses a caller holding neither gated role, and writes nothing', async () => {
    const api = world({grantRole: false});
    const error = await rejection(api.set({tool: 'semgrep', ruleId: RULE, cwes: ['CWE-95']}));
    expect(error.error).toBe(403);
    expect(api.log).toEqual([]);
    expect(api.docs).toEqual([]);
  });

  it('refuses a signed-out caller, and writes nothing', async () => {
    const api = world({user: null});
    const error = await rejection(api.set({tool: 'semgrep', ruleId: RULE, cwes: ['CWE-95']}));
    expect(error.error).toBe(403);
    expect(api.log).toEqual([]);
    expect(api.roleChecks).toEqual([]);
  });

  it('never lets a mapping reach another company\'s existing row', async () => {
    // The victim already classified the same rule. The caller assigning a
    // different weakness must create its own row and leave the victim's alone.
    const api = world({docs: [
      {_id: 'victim-1', companyId: VICTIM_CO, tool: 'semgrep', ruleId: RULE, cwes: ['CWE-1']}
    ]});
    await api.set({tool: 'semgrep', ruleId: RULE, cwes: ['CWE-95']});

    expect(api.docs).toHaveLength(2);
    expect(api.docs.find((doc) => doc._id === 'victim-1').cwes).toEqual(['CWE-1']);
    expect(api.docs.find((doc) => doc.companyId === CALLER_CO).cwes).toEqual(['CWE-95']);
  });
});

describe('#112 a non-string company short-circuits before any query', () => {
  // The dangerous shape: `find({companyId: {$ne: null}, tool, ruleId})` reads and
  // writes every tenant's mapping for that rule at once. The string check has to
  // run BEFORE the collection is touched, not merely produce an empty result.
  [{$ne: null}, {$exists: true}, ['a', 'b'], 42, null, undefined, ''].forEach((companyId) => {
    it(`refuses and issues NO query for profile.companyId=${JSON.stringify(companyId)}`, async () => {
      const user = {_id: 'user-1', profile: {companyId}, emails: [{address: 'x@y.z'}]};
      const api = world({user});

      const setError = await rejection(api.set({tool: 'semgrep', ruleId: RULE, cwes: ['CWE-95']}));
      const removeError = await rejection(api.remove({tool: 'semgrep', ruleId: RULE}));

      expect(setError.error).toBe(403);
      expect(removeError.error).toBe(403);
      expect(api.log).toEqual([]);
      expect(api.roleChecks).toEqual([]);
    });
  });

  it('NON-VACUITY: the same calls WITH a string company do query and do write', async () => {
    const api = world();
    await api.set({tool: 'semgrep', ruleId: RULE, cwes: ['CWE-95']});
    await api.remove({tool: 'semgrep', ruleId: RULE});
    expect(api.log.length).toBeGreaterThan(0);
    expect(api.roleChecks.length).toBe(2);
  });
});

// --- 4: a global default is not reachable from ts-app ----------------------

describe('#112 CweMappings.Remove withdraws only the caller\'s own assignment', () => {
  const GLOBAL = {_id: 'global-1', tool: 'semgrep', ruleId: RULE, cwes: ['CWE-94'], status: 'global'};
  const VICTIM = {_id: 'victim-1', companyId: VICTIM_CO, tool: 'semgrep', ruleId: RULE, cwes: ['CWE-1']};
  const MINE = {_id: 'mine-1', companyId: CALLER_CO, tool: 'semgrep', ruleId: RULE, cwes: ['CWE-95']};

  it('removes its own row and leaves the global default and the other tenant standing', async () => {
    const api = world({docs: [GLOBAL, VICTIM, MINE]});
    const removed = await api.remove({tool: 'semgrep', ruleId: RULE});

    expect(removed).toBe(1);
    expect(api.docs.map((doc) => doc._id).sort()).toEqual(['global-1', 'victim-1']);
  });

  it('ignores a companyId in the arguments', async () => {
    const api = world({docs: [GLOBAL, VICTIM, MINE]});
    await api.remove({tool: 'semgrep', ruleId: RULE, companyId: VICTIM_CO});

    expect(api.docs.map((doc) => doc._id).sort()).toEqual(['global-1', 'victim-1']);
    expect([...tenantsTouched(api.log)]).toEqual([CALLER_CO]);
  });

  it('always sends a non-null company in the remove selector', async () => {
    // `{companyId: null, tool, ruleId}` would delete the GLOBAL default, which
    // affects every customer. The selector must never be able to name it.
    const api = world({docs: [GLOBAL, MINE]});
    await api.remove({tool: 'semgrep', ruleId: RULE});
    const removes = api.log.filter((entry) => entry.op === 'remove');
    expect(removes).toHaveLength(1);
    expect(removes[0].selector).toEqual({companyId: CALLER_CO, tool: 'semgrep', ruleId: RULE});
  });

  it('logs the withdrawal only when something was actually withdrawn', async () => {
    // Both directions: silence when nothing matched, an entry when it did.
    const nothing = world({docs: [GLOBAL, VICTIM]});
    expect(await nothing.remove({tool: 'semgrep', ruleId: RULE})).toBe(0);
    expect(nothing.events).toEqual([]);

    const something = world({docs: [MINE]});
    expect(await something.remove({tool: 'semgrep', ruleId: RULE})).toBe(1);
    expect(something.events.map((event) => event.name)).toEqual(['logEvent']);
    expect(something.events[0].args[2]).toBe('cweMappingRemoved');
  });

  it('matches the tool name whatever case it was assigned under', async () => {
    // set() lower-cases the tool; remove() must apply the same normalisation or
    // an assignment made from the UI could never be withdrawn from it.
    const api = world();
    await api.set({tool: 'CodeQL', ruleId: RULE, cwes: ['CWE-95']});
    expect(api.docs[0].tool).toBe('codeql');
    expect(await api.remove({tool: '  CodeQL  ', ruleId: RULE})).toBe(1);
    expect(api.docs).toEqual([]);
  });

  it('requires a tool and a rule', async () => {
    const api = world();
    expect((await rejection(api.remove({ruleId: RULE}))).error).toBe(400);
    expect((await rejection(api.remove({tool: 'semgrep'}))).error).toBe(400);
    expect((await rejection(api.remove({tool: 'semgrep', ruleId: '   '}))).error).toBe(400);
    expect(api.log).toEqual([]);
  });
});

// --- the DDP retry --------------------------------------------

describe('#121 CweMappings.Set is idempotent under a DDP method retry', () => {
  it('lands the retry as an update, leaving exactly one row', async () => {
    const api = world();
    const first = await api.set({tool: 'semgrep', ruleId: RULE, cwes: ['CWE-95']});
    const second = await api.set({tool: 'semgrep', ruleId: RULE, cwes: ['CWE-95']});

    expect(second).toEqual(first);
    expect(api.docs).toHaveLength(1);
    expect(api.docs[0].cwes).toEqual(['CWE-95']);
    // The second run went down the update branch, so only one insert was ever
    // attempted - the retry did not rely on the index to save it.
    expect(api.log.filter((entry) => entry.op === 'insert')).toHaveLength(1);
  });

  it('absorbs the duplicate-key error when two runs race past the lookup', async () => {
    // The genuine reconnect race: both runs read before either wrote, so the
    // retry's own lookup misses a row that is already there and the unique index
    // is the only thing left stopping the second insert. Seeding the row and
    // blinding the lookup once reproduces exactly that interleaving.
    const api = world({
      blindFindOne: 1,
      docs: [{_id: 'map-existing', companyId: CALLER_CO, tool: 'semgrep', ruleId: RULE,
        cwes: ['CWE-95'], status: 'candidate'}]
    });
    const retry = await api.set({tool: 'semgrep', ruleId: RULE, cwes: ['CWE-95', 'CWE-94']});

    // The lookup really did miss, so the insert really was attempted.
    expect(api.log.filter((entry) => entry.op === 'insert')).toHaveLength(1);

    expect(retry.cwes).toEqual(['CWE-95', 'CWE-94']);
    expect(api.docs).toHaveLength(1);
    expect(api.docs[0].cwes).toEqual(['CWE-95', 'CWE-94']);
    // The recovery update is tenant-scoped too: it must not fall back to a
    // company-blind {tool, ruleId} selector that would rewrite every tenant's
    // row for this rule.
    const recovery = api.log.filter((entry) => entry.op === 'update').pop();
    expect(recovery.selector).toEqual({companyId: CALLER_CO, tool: 'semgrep', ruleId: RULE});
  });

  it('does not swallow an insert failure that is not a duplicate key', async () => {
    // The other direction: only E11000 may be treated as "the write already
    // landed". A connection error reported as success would lose the assignment
    // silently, which is worse than the duplicate the retry branch exists for.
    const api = worldWithFailingInsert();
    const error = await rejection(api.set({tool: 'semgrep', ruleId: RULE, cwes: ['CWE-95']}));

    expect(error.message).toContain('connection reset');
    expect(api.log.filter((entry) => entry.op === 'update')).toEqual([]);
    expect(api.events).toEqual([]);
  });

  it('records the assignment in the company log exactly once per successful call', async () => {
    const api = world();
    await api.set({tool: 'semgrep', ruleId: RULE, cwes: ['CWE-95']});
    expect(api.events.map((event) => event.name)).toEqual(['logEvent']);
    expect(api.events[0].args[2]).toBe('cweMappingAssigned');
  });
});

// A store whose insert fails with something that is NOT a duplicate key, to prove
// the retry branch is keyed on E11000 and does not swallow real failures.
function worldWithFailingInsert() {
  const log = [];
  const events = [];
  const failing = new Error('connection reset');
  failing.code = 91;

  const deps = {
    'meteor/meteor': {
      Meteor: {
        Error: function MeteorError(error, reason) {
          this.error = error;
          this.reason = reason;
          this.message = reason + ' [' + error + ']';
        },
        isClient: false,
        userAsync: async function () { return defaultUser(); },
        callAsync: async function (name) {
          events.push({name, args: Array.prototype.slice.call(arguments, 1)});
        }
      }
    },
    'meteor/alanning:roles': {Roles: {userIsInRole: async function () { return true; }}},
    '/imports/lib/collections/cweMappings': {
      findOneAsync: async function (selector) {
        log.push({op: 'findOne', selector});
        return null;
      },
      insertAsync: async function (doc) {
        log.push({op: 'insert', doc});
        throw failing;
      },
      updateAsync: async function (selector, modifier) {
        log.push({op: 'update', selector, modifier});
        return 0;
      }
    },
    '/imports/lib/sarif/cweExtract': {normalizeCwe},
    '/imports/lib/sarif/cweMappingOverlay': overlay,
    './roles': {CWE_MAPPING_WRITE_ROLES}
  };

  return {log, events, set: loadMeteorModule(SET_JS, deps).default};
}

// --- what is stored is what the overlay can match --------------------------

describe('#112 CweMappings.Set stores the one spelling the overlay matches on', () => {
  it('normalises the weakness ids on the way in', async () => {
    const api = world();
    const result = await api.set({
      tool: 'Semgrep', ruleId: '  ' + RULE + '  ',
      cwes: ['cwe-079', 'CWE-79', 'CWE 95', 'external/cwe/cwe-94']
    });

    // Padding stripped, duplicates collapsed, order preserved.
    expect(result.cwes).toEqual(['CWE-79', 'CWE-95', 'CWE-94']);
    expect(api.docs[0].tool).toBe('semgrep');
    expect(api.docs[0].ruleId).toBe(RULE);
    expect(api.docs[0].status).toBe('candidate');
  });

  it('refuses an assignment with no parseable weakness rather than storing one', async () => {
    const api = world();
    for (const cwes of [[], ['not a cwe'], [null], [{}], 'CWE-79', undefined]) {
      const error = await rejection(api.set({tool: 'semgrep', ruleId: RULE, cwes}));
      expect(error.error).toBe(400);
    }
    expect(api.docs).toEqual([]);
  });

  it('requires a tool and a rule id inside the schema limits', async () => {
    const api = world();
    expect((await rejection(api.set({ruleId: RULE, cwes: ['CWE-79']}))).error).toBe(400);
    expect((await rejection(api.set({tool: 'semgrep', cwes: ['CWE-79']}))).error).toBe(400);
    expect((await rejection(api.set({tool: 'semgrep', ruleId: '  ', cwes: ['CWE-79']}))).error).toBe(400);
    // ruleId is capped at 500 in CweMappingSchema; a longer one must be refused
    // here rather than thrown out by collection2 after the role check passed.
    expect((await rejection(api.set({
      tool: 'semgrep', ruleId: 'r'.repeat(501), cwes: ['CWE-79']
    }))).error).toBe(400);
    expect(api.docs).toEqual([]);
  });

  it('END TO END: what set() stores is what the overlay resolves for that rule', async () => {
    // The seam that makes CWE mappings work at all - a mapping written here has to be
    // found by the escaped-key lookup the read paths use. Both halves are the
    // shipped code.
    const api = world();
    await api.set({tool: 'Semgrep', ruleId: RULE, cwes: ['cwe-095']});
    const index = indexMappings(await api.findForCompany(CALLER_CO), CALLER_CO);

    // The tool name as a driver reports it, and the rule id in its STORED
    // escaped form, which is what a document's byRule map holds.
    expect(mappedCwesForRule(index, 'semgrep', RULE)).toEqual(['CWE-95']);
    expect(mappedCwesForRule(index, 'SEMGREP',
      'python___lang___security___audit___eval-detected')).toEqual(['CWE-95']);

    // ...and the other direction: withdrawn, the overlay resolves nothing.
    await api.remove({tool: 'semgrep', ruleId: RULE});
    const after = indexMappings(await api.findForCompany(CALLER_CO), CALLER_CO);
    expect(mappedCwesForRule(after, 'semgrep', RULE)).toEqual([]);
  });
});

// --- 5: findForCompany, the REST-side read ---------------------------------

describe('#112 findForCompany is the second tenancy lock, and a narrow projection', () => {
  const DOCS = [
    {_id: 'mine', companyId: CALLER_CO, tool: 'semgrep', ruleId: RULE, cwes: ['CWE-95'],
      status: 'candidate', userName: 'Sec Manager', createdBy: 'user-1'},
    {_id: 'global', tool: 'semgrep', ruleId: 'other.rule', cwes: ['CWE-94'],
      status: 'global', userName: 'TrustSource Curator', createdBy: 'ts-admin'},
    {_id: 'theirs', companyId: VICTIM_CO, tool: 'semgrep', ruleId: RULE, cwes: ['CWE-1'],
      status: 'candidate', userName: 'Their Manager'}
  ];

  it('returns the company\'s own candidates and the global defaults, and nothing else', async () => {
    const api = world({docs: DOCS});
    const found = await api.findForCompany(CALLER_CO);
    expect(found.map((doc) => doc._id).sort()).toEqual(['global', 'mine']);
  });

  it('never names the curator behind a global default', async () => {
    // A global default is TrustSource-internal; publishing its author to every
    // customer that inherits it is the leak this projection prevents.
    const api = world({docs: DOCS});
    const found = await api.findForCompany(CALLER_CO);
    found.forEach((doc) => {
      expect(Object.keys(doc).sort()).toEqual(['_id', 'companyId', 'cwes', 'ruleId', 'tool']
        .filter((field) => field !== 'companyId' || 'companyId' in doc));
      expect(doc.userName).toBeUndefined();
      expect(doc.createdBy).toBeUndefined();
      expect(doc.status).toBeUndefined();
    });
    // Both directions: the fields the overlay DOES need are present.
    const mine = found.find((doc) => doc._id === 'mine');
    expect(mine).toMatchObject({tool: 'semgrep', ruleId: RULE, cwes: ['CWE-95'], companyId: CALLER_CO});
  });

  it('asks for exactly the four overlay fields', async () => {
    const api = world({docs: DOCS});
    await api.findForCompany(CALLER_CO);
    const query = api.log.find((entry) => entry.op === 'find');
    expect(query.options).toEqual({fields: {tool: 1, ruleId: 1, cwes: 1, companyId: 1}});
    expect(query.selector).toEqual({$or: [{companyId: CALLER_CO}, {companyId: null}]});
  });

  [undefined, null, '', 0, {$ne: ''}, {$exists: true}, ['a']].forEach((companyId) => {
    it(`returns [] and issues NO query for companyId=${JSON.stringify(companyId)}`, async () => {
      const api = world({docs: DOCS});
      expect(await api.findForCompany(companyId)).toEqual([]);
      expect(api.log).toEqual([]);
    });
  });

  it('NON-VACUITY: the same call with a real company does query and does return rows', async () => {
    const api = world({docs: DOCS});
    expect((await api.findForCompany(CALLER_CO)).length).toBe(2);
    expect(api.log.filter((entry) => entry.op === 'find')).toHaveLength(1);
  });

  it('uses fetchAsync, not the client-only fetch()', async () => {
    // The fake throws on fetch(); getting a result at all proves fetchAsync ran.
    const api = world({docs: DOCS});
    await expect(api.findForCompany(CALLER_CO)).resolves.toHaveLength(2);
  });

  it('feeds the overlay a set in which the other tenant simply does not exist', async () => {
    const api = world({docs: DOCS});
    const index = indexMappings(await api.findForCompany(CALLER_CO), CALLER_CO);
    // Same rule, classified differently by the other tenant - the caller sees
    // only its own.
    expect(mappedCwesForRule(index, 'semgrep', RULE)).toEqual(['CWE-95']);
    expect(mappedCwesForRule(index, 'semgrep', RULE)).not.toContain('CWE-1');
  });
});
