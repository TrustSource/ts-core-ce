/* eslint-disable no-undef */
// Cross-tenant guard on `policy.file`.
//
// The `policyFiles` publication uses `policy.file` as a SELECTOR VALUE
// (`policyFiles.collection.find({_id: fileId})`). The Policy collection has no attached schema,
// so a client could previously store an object there; `{$gt: ''}` stops being an id match and
// becomes an operator expression, selecting every policy file of every tenant - including their
// S3 paths. The fix guards both ends: writes reject a non-string reference
// (`Policy.allow` insert/update and the `_updatePolicy` method), and the publication normalises
// whatever it reads through `policyFileId()`.
//
// `policy.js` registers everything as a side effect and exports nothing, so its guards are
// executed here for real by capturing what it hands to `Policy.allow` / `Meteor.methods`
// through stubs - not by retyping the predicates into the spec. `sanitizeQuery.js` (which
// `sanitizePolicyModifier` is built on) is loaded as the real module too.
const _ = require('underscore');
const {loadMeteorModule, readSourceWithoutComments} = require('../helpers/loadMeteorModule');

const sanitizeQuery = loadMeteorModule('imports/lib/security/sanitizeQuery.js', {});

// --- load policy.js once, capturing its registrations --------------------------------------
const allowRules = {};
const methods = {};
let updateCalls = [];

class FakeMeteorError extends Error {
  constructor(error, reason) {
    super(reason);
    this.error = error;
    this.reason = reason;
  }
}

const COMPLIANCE_USER = {_id: 'u1', profile: {companyId: 'c1'}};

// --- configurable state for the tenant-ownership gate (reset per test) ---------------------
// A policyFiles doc has no companyId; ownership is derived from its uploader (`userId`) and from
// which company's policy already references it. These lets let each test set that shape up.
let fileDoc;            // what policyFiles.collection.findOneAsync returns
let claimedElsewhere;   // a policy of ANOTHER company referencing the file (or null)
let alreadyOurs;        // a policy of OUR company already referencing the file (or null)
let usersById;          // uploader/user lookups keyed by _id

const PolicyStub = {
  allow: function (rules) { Object.assign(allowRules, rules); },
  findOneAsync: async function (selector) {
    // fileBelongsToCompany: "claimed by another company?" -> {file, companyId: {$ne: ...}}
    if (selector && selector.companyId && typeof selector.companyId === 'object') {
      return claimedElsewhere;
    }
    // fileBelongsToCompany: "already ours?" -> {file, companyId: '<string>'} (no _id)
    if (selector && selector.file && typeof selector.companyId === 'string' && !selector._id) {
      return alreadyOurs;
    }
    // _updatePolicy currentDoc lookup -> {_id, companyId}
    return {_id: 'p1', companyId: 'c1', active: true};
  },
  updateAsync: async function (selector, modifier) {
    updateCalls.push({selector, modifier});
    return 1;
  },
  find: function () { return {fetchAsync: async function () { return []; }}; }
};

const policyFilesStub = {
  collection: {findOneAsync: async function () { return fileDoc; }}
};

loadMeteorModule('imports/server/collections/policy.js', {
  'meteor/meteor': {
    Meteor: {
      publish: function () {},
      methods: function (defs) { Object.assign(methods, defs); },
      startup: function () {},
      Error: FakeMeteorError,
      users: {findOneAsync: async function (id) { return usersById[id] || COMPLIANCE_USER; }},
      userAsync: async function () { return COMPLIANCE_USER; },
      callAsync: async function () {}
    }
  },
  'meteor/alanning:roles': {Roles: {userIsInRole: async function () { return true; }}},
  'meteor/momentjs:moment': {moment: function () { return {toDate: function () { return new Date(); }}; }},
  'underscore': _,
  '/imports/lib/collections/policy': PolicyStub,
  '/imports/lib/collections/policyFiles': policyFilesStub,
  '/imports/server/ServerUtils': {getCompanyIdForUserAsync: async function () { return 'c1'; }},
  '/imports/lib/userExtUtils': {},
  '/imports/lib/security/sanitizeQuery': sanitizeQuery
}, {allowNoExports: true});

beforeEach(() => {
  updateCalls = [];
  // Default happy path: file exists, uploaded by an in-company user, referenced by nobody yet.
  fileDoc = {_id: 'fileId123', userId: 'uploaderC1'};
  claimedElsewhere = null;
  alreadyOurs = null;
  usersById = {
    u1: COMPLIANCE_USER,
    uploaderC1: {_id: 'uploaderC1', profile: {companyId: 'c1'}},
    uploaderOther: {_id: 'uploaderOther', profile: {companyId: 'OTHER'}}
  };
});

// The attack shapes an unschema'd string field can take.
const OPERATOR_REFS = [
  ['a $gt expression', {$gt: ''}],
  ['a $ne expression', {$ne: null}],
  ['a $regex expression', {$regex: '.*'}],
  ['an $exists expression', {$exists: true}],
  ['an $in list', {$in: ['a', 'b']}]
];
const NON_STRING_REFS = [
  ['an array', ['fileA', 'fileB']],
  ['a number', 42],
  ['a boolean', true],
  ['null', null],
  ['undefined', undefined],
  ['an empty string', '']
];

describe('policy.js registered the guards this spec exercises', () => {
  it('captured the allow rules and the update method (guards every test below)', () => {
    expect(typeof allowRules.insert).toBe('function');
    expect(typeof allowRules.update).toBe('function');
    expect(typeof methods._updatePolicy).toBe('function');
  });
});

describe('Policy.allow insert - the file reference must be a plain string', () => {
  it.each(OPERATOR_REFS)('rejects %s', async (_label, file) => {
    await expect(allowRules.insert('u1', {companyId: 'c1', file})).resolves.toBe(false);
  });

  it.each(NON_STRING_REFS)('rejects %s', async (_label, file) => {
    await expect(allowRules.insert('u1', {companyId: 'c1', file})).resolves.toBe(false);
  });

  // Opposite direction: the guard must not have broken the legitimate write path.
  it('still allows a normal string reference for an in-company compliance manager', async () => {
    await expect(allowRules.insert('u1', {companyId: 'c1', file: 'fileId123'})).resolves.toBe(true);
  });

  it('still refuses a cross-company insert even with a valid file reference', async () => {
    await expect(allowRules.insert('u1', {companyId: 'OTHER', file: 'fileId123'})).resolves.toBe(false);
  });
});

describe('Policy.allow update - a modifier may not set a non-string file reference', () => {
  it.each(OPERATOR_REFS)('rejects a $set of %s', async (_label, file) => {
    await expect(allowRules.update('u1', {companyId: 'c1'}, ['file'], {$set: {file}}))
      .resolves.toBe(false);
  });

  it.each(NON_STRING_REFS)('rejects a $set of %s', async (_label, file) => {
    await expect(allowRules.update('u1', {companyId: 'c1'}, ['file'], {$set: {file}}))
      .resolves.toBe(false);
  });

  it('allows a $set of a plain string reference', async () => {
    await expect(allowRules.update('u1', {companyId: 'c1'}, ['file'], {$set: {file: 'fileId123'}}))
      .resolves.toBe(true);
  });

  it('leaves updates that do not touch `file` alone', async () => {
    await expect(allowRules.update('u1', {companyId: 'c1'}, ['name'], {$set: {name: 'Renamed'}}))
      .resolves.toBe(true);
  });

  // The guard keys on presence, not truthiness - `$set: {file: undefined}` is still a write.
  it('rejects an explicitly-present undefined reference', async () => {
    await expect(allowRules.update('u1', {companyId: 'c1'}, ['file'], {$set: {file: undefined}}))
      .resolves.toBe(false);
  });
});

describe('tenant ownership - a string reference must point at a file this company owns', () => {
  // A plain-string file id survives the operator-injection guard; this second gate stops it being
  // ANOTHER tenant's file id. Ownership: the file must exist, not already be claimed by another
  // company, and either be already referenced by us or have been uploaded by one of our members.
  it('rejects a fresh file uploaded by a member of another company (insert)', async () => {
    fileDoc = {_id: 'fileId123', userId: 'uploaderOther'};
    await expect(allowRules.insert('u1', {companyId: 'c1', file: 'fileId123'})).resolves.toBe(false);
  });

  it('rejects a file already referenced by another company (insert)', async () => {
    claimedElsewhere = {_id: 'foreignPolicy'};
    await expect(allowRules.insert('u1', {companyId: 'c1', file: 'fileId123'})).resolves.toBe(false);
  });

  it('rejects a reference to a file that does not exist (insert)', async () => {
    fileDoc = null;
    await expect(allowRules.insert('u1', {companyId: 'c1', file: 'ghost'})).resolves.toBe(false);
  });

  it('rejects an orphan file with no known uploader that no company references (insert)', async () => {
    fileDoc = {_id: 'orphan', userId: undefined};
    await expect(allowRules.insert('u1', {companyId: 'c1', file: 'orphan'})).resolves.toBe(false);
  });

  it('still allows a fresh file uploaded in-company (insert happy path)', async () => {
    await expect(allowRules.insert('u1', {companyId: 'c1', file: 'fileId123'})).resolves.toBe(true);
  });

  it('allows re-using a file this company already references, even if the uploader has since moved companies', async () => {
    fileDoc = {_id: 'fileId123', userId: 'uploaderOther'};
    alreadyOurs = {_id: 'ourOtherPolicy'};
    await expect(allowRules.insert('u1', {companyId: 'c1', file: 'fileId123'})).resolves.toBe(true);
  });

  it('rejects repointing an update to another company\'s file', async () => {
    fileDoc = {_id: 'fileId123', userId: 'uploaderOther'};
    await expect(allowRules.update('u1', {companyId: 'c1'}, ['file'], {$set: {file: 'fileId123'}}))
      .resolves.toBe(false);
  });

  it('throws 403 from _updatePolicy when $set.file points at another tenant\'s file', async () => {
    fileDoc = {_id: 'fileId123', userId: 'uploaderOther'};
    await expect(methods._updatePolicy({_id: 'p1', modifier: {$set: {file: 'fileId123'}}}))
      .rejects.toMatchObject({error: 403});
    expect(updateCalls).toHaveLength(0);   // never reaches the collection
  });

  it('allows _updatePolicy to repoint to a file uploaded in-company', async () => {
    await methods._updatePolicy({_id: 'p1', modifier: {$set: {file: 'fileId123', name: 'X'}}});
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].modifier.$set.file).toBe('fileId123');
  });
});

describe('_updatePolicy - sanitises the client modifier before Mongo sees it', () => {
  function call(modifier) {
    return methods._updatePolicy({_id: 'p1', modifier});
  }

  it.each(OPERATOR_REFS)('throws 400 when the modifier sets %s as the file', async (_label, file) => {
    await expect(call({$set: {file}})).rejects.toMatchObject({error: 400});
    expect(updateCalls).toHaveLength(0);   // and never reaches the collection
  });

  it('strips $-prefixed keys out of the $set payload', async () => {
    await call({$set: {name: 'A', file: 'fileId123', $where: '1==1', evil: {$ne: null}}});
    expect(updateCalls).toHaveLength(1);
    const {$set} = updateCalls[0].modifier;
    expect($set).not.toHaveProperty('$where');
    expect($set.evil).toEqual({});          // the operator inside a value is gone too
    expect($set.name).toBe('A');
    expect($set.file).toBe('fileId123');
  });

  it('drops operators outside the {$set, $unset} allowlist entirely', async () => {
    await call({$set: {name: 'A'}, $rename: {companyId: 'x'}, $inc: {counter: 1}, $push: {log: 'x'}});
    expect(updateCalls).toHaveLength(1);
    const modifier = updateCalls[0].modifier;
    expect(Object.keys(modifier).sort()).toEqual(['$set', '$unset']);
    expect(modifier).not.toHaveProperty('$rename');
    expect(modifier).not.toHaveProperty('$inc');
  });

  it('keeps a legitimate $unset', async () => {
    await call({$set: {name: 'A'}, $unset: {description: ''}});
    expect(updateCalls[0].modifier.$unset).toHaveProperty('description');
  });

  it.each([
    ['a modifier that is not an object', 'not-an-object'],
    ['null', null],
    ['undefined', undefined],
    ['an array', [{$set: {name: 'A'}}]]
  ])('reduces %s to an empty modifier instead of forwarding it', async (_label, modifier) => {
    await call(modifier);
    expect(updateCalls).toHaveLength(1);
    // Nothing from the garbage input survives - only the fields _updatePolicy adds itself.
    expect(Object.keys(updateCalls[0].modifier.$set)).toEqual(['updatedDate']);
    expect(updateCalls[0].modifier.$set.updatedDate).toBeInstanceOf(Date);
  });

  it('always scopes the update to the caller company', async () => {
    await call({$set: {name: 'A'}});
    expect(updateCalls[0].selector).toEqual({_id: 'p1', companyId: 'c1'});
  });
});

describe('stripOperators - the primitive the sanitiser is built on', () => {
  it('removes $-prefixed keys at every depth', () => {
    expect(sanitizeQuery.stripOperators({a: {$gt: 1}, b: {c: {$ne: null}, d: 2}}))
      .toEqual({a: {}, b: {c: {}, d: 2}});
  });

  it('walks into arrays', () => {
    expect(sanitizeQuery.stripOperators([{$gt: 1}, {ok: 1}])).toEqual([{}, {ok: 1}]);
  });

  it('leaves scalars and Dates intact', () => {
    const when = new Date('2026-01-01T00:00:00Z');
    expect(sanitizeQuery.stripOperators({n: 1, s: 'x', b: true, d: when}))
      .toEqual({n: 1, s: 'x', b: true, d: when});
  });

  it('asString admits only strings', () => {
    expect(sanitizeQuery.asString('fileId')).toBe('fileId');
    expect(sanitizeQuery.asString('')).toBe('');
    [{$gt: ''}, ['a'], 1, null, undefined, true].forEach((value) => {
      expect(sanitizeQuery.asString(value)).toBeUndefined();
    });
  });
});

describe('the publication normalises whatever it reads (the other end of the guard)', () => {
  const src = readSourceWithoutComments('imports/server/collections/policyFiles.js');

  it('routes the stored reference through policyFileId before using it', () => {
    expect(src).toMatch(/function policyFileId\(value\)/);
    expect(src).toMatch(/asString\(value\)/);
  });

  it('normalises on EVERY read of fields.file, not just the first', () => {
    // Both the initial join (added) and a repoint (changed) must normalise; either one left
    // raw would reopen the selector-injection path.
    const reads = src.match(/fields\.file/g) || [];
    const normalised = src.match(/policyFileId\(fields\.file\)/g) || [];
    expect(reads.length).toBeGreaterThan(0);
    expect(normalised).toHaveLength(reads.length);
  });

  it('treats a non-string reference as "no file" rather than a selector', () => {
    expect(src).toMatch(/if \(!fileId\) return;/);
    expect(src).toMatch(/typeof fileId !== 'string'/);
  });
});
