/* eslint-disable no-undef */
// ---------------------------------------------------------------------------
// The managed-field guard on the CLIENT-REACHABLE write paths, executed
// end to end.
//
// WHAT THIS CLOSES
//
// `denyUpdate: true` is a NO-OP in this repo's vendored simple-schema, so
// `stripManagedRiskFields` / `stripManagedRiskProperties` in
// `interactors/riskProperties/managedFields.js` are the ONLY thing stopping a
// DDP or REST caller from writing `riskProperties.autoKey` and
// `riskProperties.sourceRefs*` by hand. Planting an `autoKey` adopts (or blocks)
// somebody's auto risk; clearing one makes the next import mint the duplicate
// this whole feature exists to prevent; writing `sourceRefs` puts evidence in a
// compliance artifact that no scan ever produced.
//
// `risk-managed-fields.unit.spec.js` tests those two functions in isolation and
// `cwe-risk-wiring.source.unit.spec.js` asserts that update.js/create.js mention
// them. Neither executes the interactors, so neither can tell you that the strip
// runs on the modifier that actually reaches `updateAsync`, that the stored
// subdocument it restores from is read inside the caller's own company, or that
// the `$set.edited/userId/userName` the interactor appends AFTERWARDS does not
// reopen the hole.
//
// The real shipped source of update.js and create.js runs here, with Mongo and
// Meteor faked and every pure collaborator injected REAL: `sanitizeModifier`,
// `stripDangerousOperators`, `managedFields`, and `Utils.cleanObject` (extracted
// verbatim from imports/lib/utils.js, which is far too Meteor-coupled to
// require - a hand-written stand-in would be testing the stand-in).
// ---------------------------------------------------------------------------
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const {loadMeteorModule} = require('../helpers/loadMeteorModule');
const managedFields = require('../../imports/lib/interactors/riskProperties/managedFields');

const UPDATE_JS = 'imports/lib/interactors/riskProperties/update.js';
const CREATE_JS = 'imports/lib/interactors/riskProperties/create.js';

// Meteor-free ESM, so the helper can load them with no stubs at all - the real
// sanitizers run in front of the managed-field strip, exactly as they ship.
const sanitizeQuery = loadMeteorModule('imports/lib/security/sanitizeQuery.js', {});
const {sanitizeModifier} = loadMeteorModule('imports/lib/security/sanitizeModifier.js',
  {'./sanitizeQuery': sanitizeQuery});

// Utils.cleanObject, lifted verbatim rather than retyped. If it is ever renamed
// or restructured this throws at load and every test here fails loudly instead
// of quietly exercising a spec-local copy.
const utilsRaw = fs.readFileSync(path.join(__dirname, '../../imports/lib/utils.js'), 'utf8');
const cleanObjectSrc = utilsRaw.match(/Utils\.cleanObject = function \(obj\) \{[\s\S]*?\n\};/);
if (!cleanObjectSrc) {
  throw new Error('risk-managed-fields-writepath.unit.spec.js: could not locate ' +
    'Utils.cleanObject in imports/lib/utils.js - has it been renamed or restructured?');
}
const utilsSandbox = {Utils: {}, Object, Array, module: {exports: {}}};
vm.createContext(utilsSandbox);
vm.runInContext(cleanObjectSrc[0], utilsSandbox);
const Utils = utilsSandbox.Utils;

const CO = 'company-owner';
const RISK_ID = 'risk-1';
const AUTO_KEY = 'sarif-cwe|mod1111111111111|semgrep|CWE-79';

const STORED_MANAGED = {
  autoKey: AUTO_KEY,
  autoTool: 'semgrep',
  autoCwe: 'CWE-79',
  sourceRefs: [{tool: 'semgrep', ruleId: 'js/xss', uri: 'a.js', level: 'error', count: 2}],
  sourceRefsTotal: 2,
  sourceRefsTruncated: false,
  sourceRefsPrevCount: 5
};

function world(options) {
  const opts = options || {};
  const log = [];
  const events = [];
  const stored = JSON.parse(JSON.stringify(opts.stored === undefined ? {
    _id: RISK_ID,
    companyId: CO,
    name: '[CWE-79] Weakness reported by semgrep',
    riskProperties: Object.assign({state: 'identified', origin: ['CWE'],
      description: 'kept'}, STORED_MANAGED)
  } : opts.stored));

  function MeteorError(error, reason) {
    this.error = error;
    this.reason = reason;
    this.message = reason + ' [' + error + ']';
  }
  MeteorError.prototype = Object.create(Error.prototype);
  MeteorError.prototype.name = 'Meteor.Error';

  const RiskProperties = {
    findOneAsync: async function (selector, findOptions) {
      log.push({op: 'findOne', selector, options: findOptions});
      return stored && stored._id === selector._id && stored.companyId === selector.companyId ?
        JSON.parse(JSON.stringify(stored)) : null;
    },
    updateAsync: async function (selector, modifier) {
      log.push({op: 'update', selector, modifier: JSON.parse(JSON.stringify(modifier))});
      return 1;
    },
    insertAsync: async function (doc) {
      log.push({op: 'insert', doc: JSON.parse(JSON.stringify(doc))});
      return 'risk-new';
    }
  };

  const Meteor = {
    Error: MeteorError,
    userAsync: async function () {
      return Object.prototype.hasOwnProperty.call(opts, 'user') ?
        opts.user : {_id: 'user-1', profile: {companyId: CO, name: 'Analyst'}};
    },
    callAsync: async function (name) {
      events.push({name, args: Array.prototype.slice.call(arguments, 1)});
      return null;
    }
  };

  const deps = {
    'meteor/meteor': {Meteor},
    '/imports/lib/collections/riskProperties': RiskProperties,
    '/imports/lib/security/sanitizeModifier': {sanitizeModifier},
    '/imports/lib/security/sanitizeQuery': sanitizeQuery,
    '/imports/lib/utils': Utils,
    './managedFields': managedFields
  };

  return {
    log,
    events,
    sentModifier: function () {
      const write = log.find((entry) => entry.op === 'update');
      return write && write.modifier;
    },
    insertedDoc: function () {
      const write = log.find((entry) => entry.op === 'insert');
      return write && write.doc;
    },
    update: loadMeteorModule(UPDATE_JS, deps).default,
    create: loadMeteorModule(CREATE_JS, deps).default
  };
}

// Every dotted path that reached Mongo, across every operator.
function pathsWritten(modifier) {
  const out = [];
  Object.keys(modifier || {}).forEach((op) => {
    const payload = modifier[op];
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      Object.keys(payload).forEach((field) => out.push(field));
    }
  });
  return out;
}

describe('#129 RiskProperties.Update - a client cannot write a managed field', () => {
  managedFields.MANAGED_RISK_FIELDS.forEach((field) => {
    it('strips a $set of ' + field + ' before the write', async () => {
      const w = world({});
      await w.update({$set: {[field]: 'forged', name: 'a rename the user IS allowed'}}, RISK_ID);
      const modifier = w.sentModifier();
      expect(pathsWritten(modifier)).not.toContain(field);
      // The other direction: the caller's legitimate edit still lands.
      expect(modifier.$set.name).toEqual('a rename the user IS allowed');
    });
  });

  it('strips a write INTO a managed array, however it is spelled', async () => {
    const w = world({});
    await w.update({$set: {
      'riskProperties.sourceRefs.0.count': 9999,
      'riskProperties.sourceRefs.$.uri': 'forged.js',
      'riskProperties.description': 'allowed'
    }}, RISK_ID);
    const written = pathsWritten(w.sentModifier());
    expect(written.filter((p) => p.indexOf('sourceRefs') !== -1)).toEqual([]);
    expect(written).toContain('riskProperties.description');
  });

  it('strips managed paths out of $unset, $push and $inc alike', async () => {
    const w = world({});
    await w.update({
      $unset: {'riskProperties.autoKey': ''},
      $push: {'riskProperties.sourceRefs': {tool: 'forged'}},
      $inc: {'riskProperties.sourceRefsTotal': 100}
    }, RISK_ID);
    const written = pathsWritten(w.sentModifier());
    managedFields.MANAGED_RISK_FIELDS.forEach((field) => {
      expect(written).not.toContain(field);
    });
  });

  it('a $rename cannot move a managed field away or forge one', async () => {
    const w = world({});
    await w.update({$rename: {
      'riskProperties.autoKey': 'riskProperties.stolen',
      'riskProperties.description': 'riskProperties.autoKey'
    }}, RISK_ID);
    const modifier = w.sentModifier();
    expect(modifier.$rename).toBeUndefined();
  });

  it('a wholesale replacement KEEPS the stored identity instead of dropping it', async () => {
    // `$set: {riskProperties: {...}}` REPLACES the subdocument, so simply
    // deleting the caller's managed keys would delete the stored ones too - the
    // risk would lose its autoKey and the next import would mint a duplicate.
    const w = world({});
    await w.update({$set: {riskProperties: {
      state: 'accepted',
      autoKey: 'sarif-cwe|other|codeql|CWE-1',
      sourceRefs: [{tool: 'forged', ruleId: 'x', uri: 'y', level: 'error', count: 1}],
      sourceRefsPrevCount: 0
    }}}, RISK_ID);
    const written = w.sentModifier().$set.riskProperties;
    expect(written.state).toEqual('accepted');
    Object.keys(STORED_MANAGED).forEach((key) => {
      expect(written[key]).toEqual(STORED_MANAGED[key]);
    });
  });

  it('reads the stored subdocument inside the caller\'s own company only', async () => {
    const w = world({});
    await w.update({$set: {riskProperties: {state: 'accepted'}}}, RISK_ID);
    const read = w.log.find((entry) => entry.op === 'findOne');
    expect(read.selector.companyId).toEqual(CO);
    expect(read.selector._id).toEqual(RISK_ID);
  });

  it('does NOT read the stored subdocument for an ordinary dotted edit', async () => {
    // Every risk edit in the product would otherwise cost an extra query.
    const w = world({});
    await w.update({$set: {'riskProperties.state': 'analyzed'}}, RISK_ID);
    // The audit log entry (#31) reads the risk's name; nothing reads riskProperties.
    expect(w.log.filter((entry) => entry.op === 'findOne' &&
      !(entry.options && entry.options.fields && Object.keys(entry.options.fields).join() === 'name'))).toEqual([]);
  });

  it('a wholesale $unset cannot delete the subdocument that carries the identity',
    async () => {
      const w = world({});
      await w.update({$unset: {riskProperties: ''}}, RISK_ID);
      expect(w.sentModifier().$unset).toBeUndefined();
    });

  it('overwrites a caller-supplied companyId in the filter with the caller\'s own',
    async () => {
      const w = world({});
      await w.update({$set: {name: 'x'}}, undefined, {companyId: 'company-other',
        moduleId: 'mod1'});
      const write = w.log.find((entry) => entry.op === 'update');
      expect(write.selector.companyId).toEqual(CO);
      expect(write.selector.moduleId).toEqual('mod1');
    });

  it('strips the code-execution operators from a supplied filter', async () => {
    // stripDangerousOperators deliberately PASSES $ne/$in through - the filter
    // is a legitimate query surface and tenancy rests on the forced companyId -
    // but never $where and friends.
    const w = world({});
    await w.update({$set: {name: 'x'}}, undefined,
      {$where: 'sleep(5000)', $expr: {}, moduleId: {$ne: null}});
    const write = w.log.find((entry) => entry.op === 'update');
    expect(write.selector.$where).toBeUndefined();
    expect(write.selector.$expr).toBeUndefined();
    expect(write.selector.companyId).toEqual(CO);
  });

  it('the edited/userId/userName the interactor appends do not reopen the hole',
    async () => {
      // These are added AFTER the strip, and a regression that appended them to
      // the caller's own $set object would carry the managed keys back in.
      const w = world({});
      await w.update({$set: {'riskProperties.autoKey': 'forged'}}, RISK_ID);
      const modifier = w.sentModifier();
      expect(Object.keys(modifier.$set).sort()).toEqual(['edited', 'userId', 'userName']);
    });

  it('refuses an unauthenticated caller with no API user', async () => {
    const w = world({user: null});
    await expect(w.update({$set: {name: 'x'}}, RISK_ID)).rejects.toMatchObject({error: 403});
    expect(w.log).toEqual([]);
  });
});

describe('#129 RiskProperties.Create - a manual risk cannot plant an identity', () => {
  it('drops every managed key from the create payload and keeps the rest', async () => {
    const w = world({});
    await w.create({
      projectId: 'prj1', moduleId: 'mod1', name: 'Raised in the design review',
      riskProperties: Object.assign({
        state: 'identified', origin: ['SQ'], description: 'kept'
      }, STORED_MANAGED)
    });
    const doc = w.insertedDoc();
    managedFields.MANAGED_RISK_PROPERTY_KEYS.forEach((key) => {
      expect(doc.riskProperties[key]).toBeUndefined();
    });
    expect(doc.riskProperties.state).toEqual('identified');
    expect(doc.riskProperties.origin).toEqual(['SQ']);
    expect(doc.riskProperties.description).toEqual('kept');
    expect(doc.companyId).toEqual(CO);
  });

  it('still cleans empty values, so the strip did not replace cleanObject', async () => {
    // The order is stripManagedRiskProperties -> Utils.cleanObject. If a change
    // ever swapped one for the other this is what notices.
    const w = world({});
    await w.create({name: 'x', riskProperties: {state: 'identified', blank: '',
      empty: [], nothing: null}});
    const props = w.insertedDoc().riskProperties;
    expect(Object.keys(props)).toEqual(['state']);
  });

  it('refuses an unauthenticated caller with no API user', async () => {
    const w = world({user: null});
    await expect(w.create({name: 'x', riskProperties: {}}))
      .rejects.toMatchObject({error: 403});
    expect(w.log).toEqual([]);
  });
});

// =============================================================================
// Non-plain-object payloads - added with the security fix round (finding 4).
//
// 18 modifier shapes were probed against the strippers and 17 held. The leak was
// an ARRAY: it is not a plain object, so both strippers used to hand it back
// untouched and a forged autoKey went straight through. It failed closed only
// because the vendored simple-schema rejects an array for an object-typed field
// - the same package whose `denyUpdate` is a silent no-op, so the immutability
// boundary may not depend on it.
// =============================================================================

describe('#129 the write path against a riskProperties payload that is not an object', () => {
  const FORGED = [{autoKey: 'sarif-cwe|someone-elses-module|semgrep|CWE-79',
    sourceRefs: [{tool: 'forged', ruleId: 'r', uri: 'u', level: 'error', count: 99}]}];

  it('drops a wholesale $set of an ARRAY rather than forwarding it', async () => {
    const w = world({});
    await w.update({$set: {riskProperties: FORGED, name: 'renamed'}}, RISK_ID);
    const modifier = w.sentModifier();
    expect(modifier.$set.riskProperties).toBeUndefined();
    // ...and the rest of the caller's edit still goes through.
    expect(modifier.$set.name).toEqual('renamed');
    expect(JSON.stringify(modifier)).not.toContain('someone-elses-module');
  });

  [null, 'nope', 42, true].forEach((value) => {
    it('drops a wholesale $set of ' + JSON.stringify(value) +
      ', which would take the identity with it', async () => {
      const w = world({});
      await w.update({$set: {riskProperties: value, name: 'renamed'}}, RISK_ID);
      expect(w.sentModifier().$set.riskProperties).toBeUndefined();
      expect(w.sentModifier().$set.name).toEqual('renamed');
    });
  });

  it('stores an empty subdocument instead of an ARRAY on the create path', async () => {
    const w = world({});
    await w.create({name: 'x', riskProperties: FORGED});
    const doc = w.insertedDoc();
    expect(Array.isArray(doc.riskProperties)).toBe(false);
    expect(doc.riskProperties).toEqual({});
    expect(JSON.stringify(doc)).not.toContain('someone-elses-module');
  });

  // JSON.parse - what both DDP and the REST body parser produce - makes an OWN
  // `__proto__` key, and `out[key] = value` on one runs Object.prototype's
  // setter instead of storing anything.
  it('does not hit the prototype setter on an own __proto__ key', async () => {
    const w = world({});
    const modifier = JSON.parse('{"$set":{"name":"n","__proto__":{"polluted":true}}}');
    await w.update(modifier, RISK_ID);
    expect({}.polluted).toBeUndefined();
    const sent = w.sentModifier();
    expect(Object.getPrototypeOf(sent)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(sent.$set)).toBe(Object.prototype);
    expect(sent.$set.name).toEqual('n');
  });
});
