// ---------------------------------------------------------------------------
// CSAF.Update - an editor cannot write a server-managed lifecycle field.
//
// The public CSAF feed serves documents with `published` set and no `removed`
// (imports/lib/csaf/feedAccess.js), filtered by `tlp`. Only the publish flow in
// ts-csaf.js and csaf/create.js set those fields, so a CSAF.Update caller that
// could `$set: {published: new Date()}` would put a draft in the public feed
// without an upload, `$unset: {removed: 1}` would bring a removed advisory back,
// and `$set: {tlp: 'WHITE'}` would show a RED document to WHITE-only keys.
//
// The real shipped update.js runs here with Meteor and the collection faked and
// the real sanitizeModifier / sanitizeQuery / feedAccess / managedFields
// injected, so the assertions are about the modifier that reaches updateAsync.
// ---------------------------------------------------------------------------
const {loadMeteorModule} = require('../helpers/loadMeteorModule');
const feedAccess = require('../../imports/lib/csaf/feedAccess');
const managedFields = require('../../imports/lib/interactors/csaf/managedFields');

const sanitizeQuery = loadMeteorModule('imports/lib/security/sanitizeQuery.js', {});
const sanitizeModifierModule = loadMeteorModule('imports/lib/security/sanitizeModifier.js',
  {'./sanitizeQuery': sanitizeQuery});

const CO = 'company-own';
const CSAF_ID = 'csaf-1';

// Written by update.js itself, after the client modifier is sanitized.
const SERVER_STAMPS = ['updated', 'updatedBy', 'updatedByName'];

function csafData(tlp) {
  return JSON.stringify({document: {title: 'Advisory', distribution: {tlp: {label: tlp}}}});
}

function world(options) {
  const opts = options || {};
  const writes = [];

  function MeteorError(error, reason) {
    this.error = error;
    this.reason = reason;
    this.message = reason + ' [' + error + ']';
  }
  MeteorError.prototype = Object.create(Error.prototype);

  const Meteor = {
    Error: MeteorError,
    userAsync: async function () {
      return {_id: 'user-1', profile: {companyId: CO, name: 'Editor'}};
    },
    callAsync: async function () {
      return null;
    }
  };
  const Roles = {
    userIsInRole: async function () {
      return opts.inRole !== false;
    }
  };
  const CSAF = {
    updateAsync: async function (selector, modifier) {
      writes.push({selector, modifier: JSON.parse(JSON.stringify(modifier))});
      return 1;
    }
  };
  const requireMap = {
    '/imports/lib/csaf/feedAccess': feedAccess,
    './managedFields': managedFields
  };
  const update = loadMeteorModule('imports/lib/interactors/csaf/update.js', {
    'meteor/meteor': {Meteor},
    'meteor/alanning:roles': {Roles},
    '/imports/lib/utils': {username: (user) => user.profile.name},
    '/imports/lib/collections/csaf': CSAF,
    '/imports/lib/security/sanitizeModifier': sanitizeModifierModule
  }, {
    globals: {
      require: function (specifier) {
        if (!Object.prototype.hasOwnProperty.call(requireMap, specifier)) {
          throw new Error('csaf-update-managed-fields spec: no stub for require(' + specifier + ')');
        }
        return requireMap[specifier];
      }
    }
  }).default;

  return {
    writes,
    run: function (modifier) {
      return update(modifier, CSAF_ID);
    }
  };
}

// Every [operator, path] pair that reached Mongo, $rename targets included.
function pathsWritten(modifier) {
  const out = [];
  Object.keys(modifier || {}).forEach((op) => {
    const payload = modifier[op];
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      Object.keys(payload).forEach((field) => {
        out.push([op, field]);
        if (op === '$rename') {
          out.push([op, payload[field]]);
        }
      });
    }
  });
  return out;
}

function top(path) {
  return String(path).split('.')[0];
}

// The only managed writes allowed are the ones update.js adds itself: the
// updated* stamps and tlp derived from `data`, both via $set.
function forgedManagedWrites(modifier) {
  return pathsWritten(modifier).filter(([op, path]) => {
    if (managedFields.CSAF_MANAGED_FIELDS.indexOf(top(path)) === -1) {
      return false;
    }
    return !(op === '$set' && (SERVER_STAMPS.indexOf(path) > -1 || path === 'tlp'));
  });
}

describe('CSAF managed fields list', () => {
  test('covers the lifecycle fields the publish, fail and remove flows own', () => {
    ['status', 'submitted', 'published', 'publishedFileName', 'publishedBy', 'publishedByName',
      'failed', 'failedReason', 'removed', 'removedReason', 'removedBy', 'removedByName',
      'providerId', 'tlp', 'updated', 'updatedBy', 'updatedByName'].forEach((field) => {
      expect(managedFields.CSAF_MANAGED_FIELDS).toContain(field);
    });
  });

  test('leaves the editable working copy writable', () => {
    ['data', 'name', 'category'].forEach((field) => {
      expect(managedFields.CSAF_MANAGED_FIELDS).not.toContain(field);
    });
  });
});

describe('CSAF.Update strips server-managed lifecycle fields', () => {
  const FIELDS = managedFields.CSAF_MANAGED_FIELDS;

  const VARIANTS = {
    '$set': (f) => ({$set: {[f]: f === 'published' ? new Date() : 'PUBLISHED'}}),
    '$set dotted': (f) => ({$set: {[f + '.x']: 'v'}}),
    '$set positional': (f) => ({$set: {[f + '.$']: 'v'}}),
    '$unset': (f) => ({$unset: {[f]: ''}}),
    '$rename to': (f) => ({$rename: {name: f}}),
    '$rename from': (f) => ({$rename: {[f]: 'elsewhere'}}),
    '$currentDate': (f) => ({$currentDate: {[f]: true}}),
    '$push': (f) => ({$push: {[f]: 'v'}}),
    '$inc': (f) => ({$inc: {[f]: 1}})
  };

  FIELDS.forEach((field) => {
    Object.keys(VARIANTS).forEach((variant) => {
      test(`${variant} on ${field} never reaches Mongo`, async () => {
        const w = world();
        await w.run(VARIANTS[variant](field));
        expect(w.writes).toHaveLength(1);
        expect(forgedManagedWrites(w.writes[0].modifier)).toEqual([]);
      });
    });
  });

  test('a draft cannot be marked published', async () => {
    const w = world();
    await w.run({$set: {status: 'PUBLISHED', published: new Date(), publishedFileName: 'x.json',
      name: 'Renamed'}});
    const set = w.writes[0].modifier.$set;
    expect(set).not.toHaveProperty('status');
    expect(set).not.toHaveProperty('published');
    expect(set).not.toHaveProperty('publishedFileName');
    expect(set.name).toBe('Renamed');
  });

  test('a removed document cannot be brought back', async () => {
    const w = world();
    await w.run({$unset: {removed: '', removedBy: ''}});
    expect(w.writes[0].modifier.$unset).toEqual({});
  });

  test('a forged tlp is replaced by the label in data', async () => {
    const w = world();
    await w.run({$set: {data: csafData('RED'), tlp: 'WHITE'}});
    expect(w.writes[0].modifier.$set.tlp).toBe('RED');
  });

  test('a forged tlp without a data edit is dropped', async () => {
    const w = world();
    await w.run({$set: {tlp: 'WHITE'}});
    expect(w.writes[0].modifier.$set).not.toHaveProperty('tlp');
  });

  test('the updated* stamps are the server ones, not the client ones', async () => {
    const w = world();
    await w.run({$set: {updatedBy: 'someone-else', updatedByName: 'Forged'}, $unset: {updated: ''}});
    const modifier = w.writes[0].modifier;
    expect(modifier.$set.updatedBy).toBe('user-1');
    expect(modifier.$set.updatedByName).toBe('Editor');
    expect(modifier.$unset).toEqual({});
  });

  test('companyId and _id stay protected', async () => {
    const w = world();
    await w.run({$set: {companyId: 'OTHER', _id: 'x', name: 'n'}});
    const set = w.writes[0].modifier.$set;
    expect(set).not.toHaveProperty('companyId');
    expect(set).not.toHaveProperty('_id');
    expect(w.writes[0].selector).toEqual({_id: CSAF_ID, companyId: CO});
  });

  test('a replacement-style modifier is refused and nothing is written', async () => {
    const w = world();
    await expect(w.run({status: 'PUBLISHED', published: new Date()})).rejects.toMatchObject({error: 400});
    await expect(w.run({$set: {name: 'n'}, status: 'PUBLISHED'})).rejects.toMatchObject({error: 400});
    expect(w.writes).toHaveLength(0);
  });

  test('a normal data edit still applies and derives tlp', async () => {
    const w = world();
    const data = csafData('amber');
    await w.run({$set: {data}});
    const set = w.writes[0].modifier.$set;
    expect(set.data).toBe(data);
    expect(set.tlp).toBe('AMBER');
    expect(set.updatedBy).toBe('user-1');
    expect(set.updated).toBeDefined();
  });

  test('a caller without a CSAF role is refused', async () => {
    const w = world({inRole: false});
    await expect(w.run({$set: {data: csafData('WHITE')}})).rejects.toMatchObject({error: 403});
    expect(w.writes).toHaveLength(0);
  });
});
