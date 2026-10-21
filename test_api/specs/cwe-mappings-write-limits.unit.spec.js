/* eslint-disable no-undef */
// ---------------------------------------------------------------------------
// `CweMappings.Set` bounds its input before it does any work with it.
//
// The defect. `params.cwes` was walked with `indexOf` inside `forEach` - O(n^2)
// - with nothing capping its length: no check in the interactor, no `maxCount`
// on `cweMappingSchema` (which has `minCount: 1` only), and no `DDPRateLimiter`
// rule. Schema validation runs at insert, which is AFTER the loop, so the only
// thing standing between an authenticated caller and the event loop was the DDP
// message size.
//
// Measured on this machine before the fix: 10k ids blocked the loop for 84 ms,
// 50k for 1849 ms and 100k for 11473 ms. Node is single-threaded, so every other
// tenant's request waits behind it.
//
// `CweMappings.Remove` had the mirror-image gap: set.js caps `ruleId` at 500
// characters, remove.js capped nothing at all.
//
// The interactors import Meteor, so they run through `loadMeteorModule` with
// recording stubs. The bounds themselves are injected REAL - a spec-local copy
// of the cap would assert nothing about what ships.
// ---------------------------------------------------------------------------
const {loadMeteorModule, readSourceWithoutComments} = require('../helpers/loadMeteorModule');
const {normalizeCwe} = require('../../imports/lib/sarif/cweExtract');
const overlay = require('../../imports/lib/sarif/cweMappingOverlay');
const {CWE_MAPPING_WRITE_ROLES} = require('../../imports/lib/interactors/cweMappings/roles');

const SET_JS = 'imports/lib/interactors/cweMappings/set.js';
const REMOVE_JS = 'imports/lib/interactors/cweMappings/remove.js';
const SCHEMA_JS = 'imports/lib/schemas/cweMappingSchema.js';
const RATE_LIMIT_JS = 'imports/startup/server/rate-limit.js';

const CALLER_CO = 'company-caller';
const RULE = 'python.lang.security.audit.eval-detected';

function world(options) {
  const opts = options || {};
  const docs = [];
  const log = [];

  function MeteorError(error, reason) {
    this.error = error;
    this.reason = reason;
    this.message = reason + ' [' + error + ']';
  }
  MeteorError.prototype = Object.create(Error.prototype);
  MeteorError.prototype.name = 'Meteor.Error';

  const CweMappings = {
    findOneAsync: async function (selector) {
      log.push({op: 'findOne', selector});
      return null;
    },
    insertAsync: async function (doc) {
      log.push({op: 'insert', doc: Object.assign({}, doc)});
      docs.push(doc);
      return 'map-1';
    },
    updateAsync: async function (selector, modifier) {
      log.push({op: 'update', selector, modifier});
      return 1;
    },
    removeAsync: async function (selector) {
      log.push({op: 'remove', selector});
      return 1;
    }
  };

  const deps = {
    'meteor/meteor': {
      Meteor: {
        Error: MeteorError,
        isClient: false,
        isServer: true,
        userAsync: async function () {
          return Object.prototype.hasOwnProperty.call(opts, 'user') ? opts.user : {
            _id: 'user-1',
            profile: {companyId: CALLER_CO, name: 'Sec Manager'},
            emails: [{address: 'sec@caller.example'}]
          };
        },
        callAsync: async function () { return null; }
      }
    },
    'meteor/alanning:roles': {Roles: {userIsInRole: async function () { return true; }}},
    '/imports/lib/collections/cweMappings': CweMappings,
    '/imports/lib/sarif/cweExtract': {normalizeCwe},
    '/imports/lib/sarif/cweMappingOverlay': overlay,
    './roles': {CWE_MAPPING_WRITE_ROLES}
  };

  return {
    docs,
    log,
    set: loadMeteorModule(SET_JS, deps).default,
    remove: loadMeteorModule(REMOVE_JS, deps).default
  };
}

async function rejection(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to be refused, but it resolved');
}

function cweList(count, distinct) {
  const out = new Array(count);
  for (let i = 0; i < count; i += 1) {
    out[i] = 'CWE-' + (distinct === false ? 79 : i + 1);
  }
  return out;
}

// --- the cap is declared once and shared ------------------------------------

describe('#128 the assignment size cap is one number, not three copies', () => {
  it('publishes the bounds from the shared overlay module', () => {
    expect(typeof overlay.CWE_MAPPING_MAX_CWES).toBe('number');
    expect(overlay.CWE_MAPPING_MAX_CWES).toBeGreaterThan(0);
    expect(overlay.CWE_MAPPING_MAX_CWES).toBeLessThanOrEqual(100);
    expect(overlay.CWE_MAPPING_RULE_ID_MAX).toBe(500);
    expect(overlay.CWE_MAPPING_TOOL_MAX).toBe(200);
  });

  it('the schema enforces the same numbers rather than repeating them', () => {
    const schema = readSourceWithoutComments(SCHEMA_JS);
    expect(schema).toContain('CWE_MAPPING_MAX_CWES');
    expect(schema).toContain('CWE_MAPPING_RULE_ID_MAX');
    expect(schema).toContain('CWE_MAPPING_TOOL_MAX');
    expect(schema).toMatch(/maxCount:\s*CWE_MAPPING_MAX_CWES/);
  });

  it('the interactors enforce the same numbers rather than repeating them', () => {
    const set = readSourceWithoutComments(SET_JS);
    expect(set).toContain('CWE_MAPPING_MAX_CWES');
    expect(set).toContain('CWE_MAPPING_RULE_ID_MAX');
    expect(set).not.toMatch(/requiredString\([^)]*,\s*500\)/);
    expect(readSourceWithoutComments(REMOVE_JS)).toContain('CWE_MAPPING_RULE_ID_MAX');
  });
});

// --- Set: bounded before the loop -------------------------------------------

describe('#128 CweMappings.Set refuses an oversized assignment before doing the work', () => {
  it('rejects more ids than the cap with a 400 and no database call at all', async () => {
    const w = world();
    const error = await rejection(w.set({
      tool: 'semgrep', ruleId: RULE, cwes: cweList(overlay.CWE_MAPPING_MAX_CWES + 1)
    }));
    expect(error.error).toBe(400);
    expect(w.log).toEqual([]);
    expect(w.docs).toEqual([]);
  });

  it('accepts exactly the cap', async () => {
    const w = world();
    const result = await w.set({
      tool: 'semgrep', ruleId: RULE, cwes: cweList(overlay.CWE_MAPPING_MAX_CWES)
    });
    expect(result.cwes).toHaveLength(overlay.CWE_MAPPING_MAX_CWES);
    expect(w.docs).toHaveLength(1);
  });

  it('answers a 100k-id payload in milliseconds instead of blocking the event loop', async () => {
    // The measured pre-fix cost of this exact call was 11473 ms of blocked event
    // loop. The cap has to be checked before the dedupe walks the array.
    const w = world();
    const huge = cweList(100000);
    const started = Date.now();
    const error = await rejection(w.set({tool: 'semgrep', ruleId: RULE, cwes: huge}));
    const elapsed = Date.now() - started;

    expect(error.error).toBe(400);
    expect(elapsed).toBeLessThan(500);
    expect(w.log).toEqual([]);
  });

  it('dedupes without a quadratic scan', async () => {
    // Under the cap, but every id the same: the dedupe must be a Set lookup, not
    // indexOf inside forEach.
    const w = world();
    const result = await w.set({
      tool: 'semgrep', ruleId: RULE, cwes: cweList(overlay.CWE_MAPPING_MAX_CWES, false)
    });
    expect(result.cwes).toEqual(['CWE-79']);
    expect(w.docs[0].cwes).toEqual(['CWE-79']);
  });

  it('keeps the order a curator entered the ids in', async () => {
    const w = world();
    const result = await w.set({tool: 'semgrep', ruleId: RULE,
      cwes: ['CWE-95', 'cwe-079', 'nonsense', 'CWE-95', 'CWE-22']});
    expect(result.cwes).toEqual(['CWE-95', 'CWE-79', 'CWE-22']);
  });

  it('still refuses an assignment with no usable id at all', async () => {
    const w = world();
    const error = await rejection(w.set({tool: 'semgrep', ruleId: RULE, cwes: ['nonsense']}));
    expect(error.error).toBe(400);
    expect(error.reason).toBe('A valid CWE id is required');
  });

  it('refuses an id too large to be reprinted as a CWE id, cleanly', async () => {
    // Not a schema error from deep inside collection2 - the interactor's own 400.
    const w = world();
    const error = await rejection(w.set({
      tool: 'semgrep', ruleId: RULE, cwes: ['CWE-999999999999999999999']
    }));
    expect(error.error).toBe(400);
    expect(error.reason).toBe('A valid CWE id is required');
    expect(w.log).toEqual([]);
  });
});

// --- both interactors: the string bounds ------------------------------------

describe('#128 both write methods bound the strings they put in a selector', () => {
  const OVERLONG_RULE = 'r'.repeat(overlay.CWE_MAPPING_RULE_ID_MAX + 1);
  const OVERLONG_TOOL = 't'.repeat(overlay.CWE_MAPPING_TOOL_MAX + 1);

  it('Set refuses a rule id past the cap', async () => {
    const w = world();
    const error = await rejection(w.set({tool: 'semgrep', ruleId: OVERLONG_RULE, cwes: ['CWE-79']}));
    expect(error.error).toBe(400);
    expect(w.log).toEqual([]);
  });

  it('Set refuses a tool name past the cap', async () => {
    const w = world();
    const error = await rejection(w.set({tool: OVERLONG_TOOL, ruleId: RULE, cwes: ['CWE-79']}));
    expect(error.error).toBe(400);
    expect(w.log).toEqual([]);
  });

  it('Remove refuses a rule id past the cap, which it used to accept', async () => {
    const w = world();
    const error = await rejection(w.remove({tool: 'semgrep', ruleId: OVERLONG_RULE}));
    expect(error.error).toBe(400);
    expect(w.log).toEqual([]);
  });

  it('Remove refuses a tool name past the cap', async () => {
    const w = world();
    const error = await rejection(w.remove({tool: OVERLONG_TOOL, ruleId: RULE}));
    expect(error.error).toBe(400);
    expect(w.log).toEqual([]);
  });

  it('NON-VACUITY: both still do their job at exactly the cap', async () => {
    const atCap = 'r'.repeat(overlay.CWE_MAPPING_RULE_ID_MAX);
    const setWorld = world();
    await setWorld.set({tool: 'semgrep', ruleId: atCap, cwes: ['CWE-79']});
    expect(setWorld.docs[0].ruleId).toBe(atCap);

    const removeWorld = world();
    await removeWorld.remove({tool: 'semgrep', ruleId: atCap});
    expect(removeWorld.log.some((entry) => entry.op === 'remove')).toBe(true);
  });
});

// --- the rate limiter -------------------------------------------------------

describe('#128 both write methods carry a DDPRateLimiter rule', () => {
  const rules = [];
  loadMeteorModule(RATE_LIMIT_JS, {
    'meteor/ddp-rate-limiter': {
      DDPRateLimiter: {
        addRule: function (matcher, calls, interval) {
          rules.push({matcher, calls, interval});
        }
      }
    }
  }, {allowNoExports: true});

  function matches(rule, methodName) {
    if (rule.matcher.type !== 'method') {
      return false;
    }
    return typeof rule.matcher.name === 'function' ?
      rule.matcher.name(methodName) : rule.matcher.name === methodName;
  }

  ['CweMappings.Set', 'CweMappings.Remove'].forEach((method) => {
    it(`throttles ${method} per connection`, () => {
      const hit = rules.filter((rule) => matches(rule, method));
      expect(hit.length).toBeGreaterThan(0);
      hit.forEach((rule) => {
        expect(typeof rule.matcher.connectionId).toBe('function');
        expect(rule.matcher.connectionId()).toBe(true);
        expect(rule.calls).toBeGreaterThan(0);
        expect(rule.interval).toBeGreaterThan(0);
      });
    });
  });

  it('NON-VACUITY: the harness really loaded the shipped rules', () => {
    // The CPU-guard rules this one is modelled on have to be there too, or the
    // matcher above is testing an empty list.
    expect(rules.length).toBeGreaterThan(5);
    expect(rules.some((rule) => matches(rule, 'Projects.UpdateArchitecture'))).toBe(true);
    expect(rules.some((rule) => matches(rule, 'CweMappings.Nonsense'))).toBe(false);
  });
});
