/* eslint-disable no-undef */
// ---------------------------------------------------------------------------
// The project toggle's WRITE path, executed rather than described.
//
// `imports/lib/interactors/projects/updateAutoCreateCweRisks.js` is the only
// thing that can switch the feature on for a project. Its whole reason for
// existing is that the general-settings autoForm route CANNOT be trusted with
// it: `isModificationAllowed()` is a per-field allow-list with no branch for a
// single-field update, and the form survives today only through an unbounded
// `relatedUsers` branch that stops matching whenever those Session-backed lists
// are empty - a save that reports success and silently does nothing (AC2).
//
// `cwe-risk-wiring.source.unit.spec.js` asserts the shape of this file's source.
// That cannot tell you the role check runs BEFORE the project is read, that a
// project in another company is refused, or that a truthy-but-not-true argument
// is stored as a real Boolean - which matters because every read of the field is
// a strict `=== true`, so a stored `'true'` would mean OFF and look to the user
// like a setting that will not stick.
//
// Loaded through the repo's `loadMeteorModule` helper: the real shipped source
// runs with its imports swapped for recording stand-ins.
// ---------------------------------------------------------------------------
const {loadMeteorModule} = require('../helpers/loadMeteorModule');

const TOGGLE_JS = 'imports/lib/interactors/projects/updateAutoCreateCweRisks.js';

const CO = 'company-owner';
const OTHER_CO = 'company-other';
const PROJECT = 'prj1111111111111';

function world(options) {
  const opts = options || {};
  const log = [];
  const roleChecks = [];
  const projects = (opts.projects === undefined ?
    [{_id: PROJECT, companyId: CO, name: 'Checkout'}] :
    [].concat(opts.projects || [])).map(function (doc) { return Object.assign({}, doc); });

  function MeteorError(error, reason) {
    this.error = error;
    this.reason = reason;
    this.message = reason + ' [' + error + ']';
  }
  MeteorError.prototype = Object.create(Error.prototype);
  MeteorError.prototype.name = 'Meteor.Error';

  const Projects = {
    findOneAsync: async function (selector, findOptions) {
      log.push({op: 'findOne', selector, options: findOptions});
      const id = typeof selector === 'string' ? selector : selector._id;
      return projects.find(function (doc) { return doc._id === id; }) || null;
    },
    updateAsync: async function (selector, modifier) {
      log.push({op: 'update', selector, modifier: JSON.parse(JSON.stringify(modifier))});
      if (opts.updatedCount !== undefined) {
        return opts.updatedCount;
      }
      const id = typeof selector === 'string' ? selector : selector._id;
      const hit = projects.find(function (doc) { return doc._id === id; });
      if (!hit) {
        return 0;
      }
      Object.assign(hit, modifier.$set);
      return 1;
    }
  };

  const deps = {
    'meteor/meteor': {Meteor: {
      Error: MeteorError,
      userAsync: async function () {
        return Object.prototype.hasOwnProperty.call(opts, 'user') ?
          opts.user : {_id: 'user-1', profile: {companyId: CO}};
      }
    }},
    'meteor/alanning:roles': {Roles: {
      userIsInRole: async function (user, roles, group) {
        roleChecks.push({user, roles, group});
        return opts.grantRole === undefined ? true : opts.grantRole;
      }
    }},
    '/imports/lib/collections/projects': Projects
  };

  return {log, roleChecks, projects,
    update: loadMeteorModule(TOGGLE_JS, deps).default};
}

describe('#129 Projects.UpdateAutoCreateCweRisks - authorisation', () => {
  it('refuses a signed-out caller before reading any project', async () => {
    const w = world({user: null});
    await expect(w.update(PROJECT, true)).rejects.toMatchObject({error: 403});
    expect(w.log).toEqual([]);
  });

  it('refuses a caller whose profile carries no companyId', async () => {
    const w = world({user: {_id: 'user-1', profile: {}}});
    await expect(w.update(PROJECT, true)).rejects.toMatchObject({error: 403});
    expect(w.log).toEqual([]);
  });

  it('refuses a caller without one of the three roles, before reading the project',
    async () => {
      const w = world({grantRole: false});
      await expect(w.update(PROJECT, true)).rejects.toMatchObject({error: 403});
      expect(w.log).toEqual([]);
    });

  it('asks for exactly the role list the frontend disables the control on', async () => {
    // Designer concern #4: a UI gated on a different set than the method
    // authorises produces either an enabled control that 403s or a disabled one
    // the server would have allowed. Both halves must name the same three.
    const w = world({});
    await w.update(PROJECT, true);
    expect(w.roleChecks.length).toEqual(1);
    expect(w.roleChecks[0].roles.slice().sort())
      .toEqual(['account_admin', 'compliance_manager', 'manager']);
    // Scoped to the caller's own company, never to a company from the arguments.
    expect(w.roleChecks[0].group).toEqual(CO);
  });

  it('refuses a project owned by another company', async () => {
    const w = world({projects: [{_id: PROJECT, companyId: OTHER_CO}]});
    await expect(w.update(PROJECT, true)).rejects.toMatchObject({error: 403});
    expect(w.log.filter((entry) => entry.op === 'update')).toEqual([]);
  });

  it('refuses a project that does not exist', async () => {
    const w = world({projects: []});
    await expect(w.update(PROJECT, true)).rejects.toMatchObject({error: 403});
    expect(w.log.filter((entry) => entry.op === 'update')).toEqual([]);
  });

  // --- added with the security fix round (finding 2) ----------------------
  //
  // A bare id handed to Mongo is a full selector when it is an object, so an
  // untyped projectId turns a scoped read into an unscoped one. Checked before
  // either query so nothing proportional to the argument runs first.
  [{}, [], {$ne: null}, 42, null, undefined, true, ''].forEach((value) => {
    it('refuses a projectId that is not a non-empty string: ' + JSON.stringify(value),
      async () => {
        const w = world({});
        await expect(w.update(value, true)).rejects.toMatchObject({error: 400});
        expect(w.log).toEqual([]);
        expect(w.roleChecks).toEqual([]);
      });
  });

  // Ownership was read off the document the findOne RETURNED, but updateAsync
  // re-runs its own selector independently of that read - so an unscoped one is
  // a write with no tenant boundary of its own.
  it('scopes BOTH the read and the write to the caller\'s own company', async () => {
    const w = world({});
    await w.update(PROJECT, true);
    const selectors = w.log.map((entry) => entry.selector);
    expect(selectors.length).toEqual(2);
    selectors.forEach((selector) => {
      expect(typeof selector).toEqual('object');
      expect(selector._id).toEqual(PROJECT);
      expect(selector.companyId).toEqual(CO);
    });
  });
});

describe('#129 Projects.UpdateAutoCreateCweRisks - what it stores', () => {
  it('AC2: stores a real Boolean true and nothing else', async () => {
    const w = world({});
    await w.update(PROJECT, true);
    const update = w.log.find((entry) => entry.op === 'update');
    expect(update.modifier).toEqual({$set: {autoCreateCweRisks: true}});
    expect(w.projects[0].autoCreateCweRisks).toBe(true);
  });

  it('stores false when switched off, rather than removing the field', async () => {
    const w = world({projects: [{_id: PROJECT, companyId: CO, autoCreateCweRisks: true}]});
    await w.update(PROJECT, false);
    expect(w.projects[0].autoCreateCweRisks).toBe(false);
  });

  // Every read of this field is a strict `=== true`, so anything stored that is
  // not a real Boolean true silently means OFF - and the user, having seen the
  // switch move and a success toast, has no way to tell.
  [['a string', 'true'], ['a number', 1], ['an object', {}], ['an array', []],
    ['undefined', undefined], ['null', null], ['a zero', 0]].forEach(([label, value]) => {
    it('coerces ' + label + ' rather than storing it verbatim', async () => {
      const w = world({});
      await w.update(PROJECT, value);
      expect(typeof w.projects[0].autoCreateCweRisks).toEqual('boolean');
      expect(w.projects[0].autoCreateCweRisks).toBe(value === true);
    });
  });

  it('reports a failed write instead of answering success', async () => {
    // The whole reason this method exists is a write path that reported success
    // while silently doing nothing. A zero-document update must be an error.
    const w = world({updatedCount: 0});
    await expect(w.update(PROJECT, true)).rejects.toMatchObject({error: 500});
  });

  it('does not touch any other field on the project', async () => {
    const w = world({projects: [{_id: PROJECT, companyId: CO, name: 'Checkout',
      description: 'Payments'}]});
    await w.update(PROJECT, true);
    expect(w.projects[0].name).toEqual('Checkout');
    expect(w.projects[0].description).toEqual('Payments');
  });
});
