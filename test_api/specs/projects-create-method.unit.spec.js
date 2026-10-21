/* eslint-disable no-undef */
// `Projects.Create` - the DDP create path, moved off `Projects.allow({insert})`.
//
// Two client sites created projects by inserting straight over DDP (the Projects list modal
// and the scan-import "new project" option), gated only by an allow rule. That rule could not
// do the things this change needs:
//   - it never saw an untrimmed name as a problem, so a crafted DDP client could store
//     `"  Storefront  "` beside `"Storefront"` - the duplicate state the resolver exists to
//     arbitrate, re-created at a boundary the resolver did not close;
//   - it compared a CLIENT-SUPPLIED `doc.companyId` against the caller's own company, so the
//     tenant of a create was a request field with a check bolted beside it rather than a
//     value derived from the session;
//   - it could not answer "that name is taken" at all, because an allow rule returns a
//     boolean and the client had already decided what to insert.
//
// Everything below runs the REAL interactor (helpers/loadMeteorModule swaps its Meteor
// imports for the stubs here), so these are assertions about production control flow, not
// about a retyped copy of it. `normalizeProjectName` is loaded for real too - stubbing the
// trim would make the "stored name is trimmed" assertions test the stub.
//
// The error contract asserted here is the one the frontend is coding against:
//   400 'Invalid arguments'                         - args not an object, or name not a string
//   400 <schema message>                            - name fails ProjectSchema
//   403 'Access Denied'                             - no user, or wrong role
//   409 'A project with this name already exists'   - taken, and no uniqueSuffix
//   500 'Could not create project'                  - insert produced no id, or suffixes ran out
//
// 409 is a HARD refusal, deliberately asymmetric with REST's idempotent 200 {existing: true}:
// a CI job re-posting a name wants the project that is already there, while a human clicking
// "Create project" is about to navigate into whatever comes back, and silently handing them
// somebody else's project is the worse failure.
const {loadMeteorModule} = require('../helpers/loadMeteorModule');

const {normalizeProjectName} = loadMeteorModule('imports/lib/project/projectName.js', {});

const COMPANY = 'company-1';
const MANAGER = {_id: 'u1', profile: {companyId: COMPANY}};

class FakeMeteorError extends Error {
  constructor(error, reason) {
    super(reason);
    this.error = error;
    this.reason = reason;
  }
}

// A stand-in for ProjectSchema's `name` rule. The real schema is pinned by its own specs and
// by the REST 400 arms; what this file needs is only a context that can answer valid/invalid
// and produce a message, so the interactor's branch ordering is what gets exercised.
function fakeProjectSchema() {
  return {
    newContext: function () {
      const errors = {};
      return {
        validateOne: function (doc, key) {
          const value = doc && doc[key];
          delete errors[key];
          if (key === 'creationDate') {
            if (!(value instanceof Date)) { errors[key] = 'Creation Date must be a valid date'; }
          } else if (typeof value !== 'string') {
            errors[key] = 'Name is required';
          } else if (value.length < 3) {
            errors[key] = 'Name must be at least 3 characters';
          } else if (value.length > 200) {
            errors[key] = 'Name cannot exceed 200 characters';
          } else if (/[<>`]/.test(value)) {
            errors[key] = 'Name failed regular expression validation';
          }
          return !errors[key];
        },
        keyErrorMessage: function (key) { return errors[key] || ''; }
      };
    }
  };
}

/**
 * Load the real interactor over recording stubs.
 *
 * @param {Object} [options] user (default a manager), inRole (default true),
 *                           existingNames (names findProjectByName answers for),
 *                           insertId (what insertAsync returns; default a fresh id)
 */
function loadCreate(options) {
  const opts = options || {};
  const taken = new Set(opts.existingNames || []);
  const state = {
    inserted: [],
    lookups: [],
    roleChecks: [],
    relatedUsersCalls: [],
    logEvents: []
  };

  const create = loadMeteorModule('imports/lib/interactors/projects/create.js', {
    'meteor/meteor': {
      Meteor: {
        Error: FakeMeteorError,
        userAsync: async function () {
          return Object.prototype.hasOwnProperty.call(opts, 'user') ? opts.user : MANAGER;
        },
        callAsync: async function (method, ...args) {
          if (method === 'setRelatedUsers') {
            state.relatedUsersCalls.push({userId: args[0], doc: args[1]});
            // The real method mutates and returns the doc it was handed.
            args[1].relatedUsers = {defaultProjectManager: args[0], defaultComplianceManager: null, members: []};
            return args[1];
          }
          if (method === 'logEvent') {
            state.logEvents.push({user: args[0], message: args[1], type: args[2]});
            return undefined;
          }
          throw new Error(`unexpected Meteor.callAsync('${method}')`);
        }
      }
    },
    'meteor/alanning:roles': {
      Roles: {
        userIsInRole: async function (user, roles, companyId) {
          state.roleChecks.push({user: user, roles: roles, companyId: companyId});
          return opts.inRole !== false;
        }
      }
    },
    '/imports/lib/collections/projects': {
      default: {
        insertAsync: async function (doc) {
          state.inserted.push(doc);
          if (Object.prototype.hasOwnProperty.call(opts, 'insertId')) { return opts.insertId; }
          return 'new-project-' + state.inserted.length;
        }
      }
    },
    '/imports/lib/schemas/projectSchema': {ProjectSchema: fakeProjectSchema()},
    '/imports/lib/project/projectName': {normalizeProjectName: normalizeProjectName},
    '/imports/server/rest-api/projectResolver': {
      findProjectByName: async function (args) {
        state.lookups.push(args);
        return taken.has(args.name) ? {_id: 'existing-' + args.name} : null;
      }
    }
  }).default;

  return {create: create, state: state};
}

/** Await `promise` and return the Meteor.Error it rejects with, failing if it resolves. */
async function rejection(promise) {
  let error = null;
  try {
    await promise;
  } catch (e) {
    error = e;
  }
  expect(error).not.toBeNull();
  return error;
}

describe('Projects.Create rejects arguments it cannot trust', () => {
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a string', 'Storefront'],
    ['a number', 7],
    ['an array', ['Storefront']]
  ])('answers 400 Invalid arguments for %s', async (_label, args) => {
    const {create, state} = loadCreate();
    const error = await rejection(create(args));
    expect(error.error).toEqual(400);
    expect(error.reason).toEqual('Invalid arguments');
    // Nothing may have happened yet - not a role check, not a lookup, not a write.
    expect(state.lookups).toEqual([]);
    expect(state.inserted).toEqual([]);
  });

  it.each([
    ['a missing name', {}],
    ['a number', {name: 42}],
    ['an object', {name: {first: 'Store'}}],
    ['an operator expression', {name: {$gt: ''}}],
    ['an array', {name: ['Storefront']}],
    ['null', {name: null}]
  ])('answers 400 Invalid arguments for %s as the name', async (_label, args) => {
    const {create, state} = loadCreate();
    const error = await rejection(create(args));
    expect(error.error).toEqual(400);
    expect(error.reason).toEqual('Invalid arguments');
    expect(state.inserted).toEqual([]);
  });

  it.each([
    ['too short after trimming', '  ab  ', 'at least 3'],
    ['whitespace only', '        ', 'at least 3'],
    ['over the length cap', 'x'.repeat(201), 'cannot exceed'],
    ['carrying markup', 'Store<script>front', 'regular expression']
  ])('answers 400 with the schema message when the name is %s', async (_label, name, fragment) => {
    const {create, state} = loadCreate();
    const error = await rejection(create({name: name}));
    expect(error.error).toEqual(400);
    expect(error.reason).toContain(fragment);
    // Validation runs BEFORE the uniqueness lookup, so an invalid name can never match an
    // existing row - and never becomes a query.
    expect(state.lookups).toEqual([]);
    expect(state.inserted).toEqual([]);
  });
});

describe('Projects.Create authorizes against the session, not the request', () => {
  it('answers 403 when there is no user', async () => {
    const {create, state} = loadCreate({user: null});
    const error = await rejection(create({name: 'Storefront'}));
    expect(error.error).toEqual(403);
    expect(error.reason).toEqual('Access Denied');
    expect(state.inserted).toEqual([]);
  });

  it('answers 403 when the user has no company', async () => {
    const {create} = loadCreate({user: {_id: 'u9', profile: {}}});
    const error = await rejection(create({name: 'Storefront'}));
    expect(error.error).toEqual(403);
    expect(error.reason).toEqual('Access Denied');
  });

  it('answers 403 when the user holds none of the create roles', async () => {
    const {create, state} = loadCreate({inRole: false});
    const error = await rejection(create({name: 'Storefront'}));
    expect(error.error).toEqual(403);
    expect(error.reason).toEqual('Access Denied');
    expect(state.lookups).toEqual([]);
    expect(state.inserted).toEqual([]);
  });

  it('requires exactly the role set the allow rule required - neither widened nor narrowed', async () => {
    const {create, state} = loadCreate();
    await create({name: 'Storefront'});
    expect(state.roleChecks.length).toEqual(1);
    expect(state.roleChecks[0].roles).toEqual(['manager', 'compliance_manager']);
    // Scoped to the caller's OWN company: a role held in some other company must not let a
    // user create there, and `Roles.userIsInRole` without a scope would check exactly that.
    expect(state.roleChecks[0].companyId).toEqual(COMPANY);
    expect(state.roleChecks[0].user).toBe(MANAGER);
  });

  it('ignores a client-supplied companyId everywhere it could matter', async () => {
    const {create, state} = loadCreate();

    const result = await create({name: 'Storefront', companyId: 'OTHER_COMPANY', _id: 'chosen-id'});

    expect(state.roleChecks[0].companyId).toEqual(COMPANY);
    expect(state.lookups[0].companyId).toEqual(COMPANY);
    expect(state.inserted[0].companyId).toEqual(COMPANY);
    // The document is BUILT, never merged from the arguments - so a caller-chosen `_id`
    // (ProjectSchema marks `_id` optional, so an insert would otherwise honour it) and any
    // other field of the request cannot ride along.
    expect(Object.keys(state.inserted[0]).sort())
      .toEqual(['companyId', 'creationDate', 'name', 'relatedUsers']);
    expect(state.inserted[0]._id).toBeUndefined();
    expect(result.projectId).toEqual('new-project-1');
  });
});

describe('Projects.Create stores a trimmed name and looks up the trimmed name', () => {
  it.each([
    ['leading and trailing spaces', '  Storefront  '],
    ['a tab and a newline', '\tStorefront\n'],
    ['a trailing space only', 'Storefront ']
  ])('trims %s before both the lookup and the write', async (_label, input) => {
    const {create, state} = loadCreate();

    const result = await create({name: input});

    expect(state.lookups.length).toEqual(1);
    expect(state.lookups[0].name).toEqual('Storefront');
    // The projection is narrow on purpose: this lookup answers "is the name taken", and the
    // id is the only field it needs to answer it.
    expect(state.lookups[0].fields).toEqual({_id: 1});
    expect(state.inserted[0].name).toEqual('Storefront');
    expect(result.name).toEqual('Storefront');
  });

  it('leaves interior whitespace and case alone', async () => {
    const {create, state} = loadCreate();
    await create({name: '   My   STORE Front   '});
    expect(state.inserted[0].name).toEqual('My   STORE Front');
  });

  it('stamps the creationDate itself', async () => {
    const {create, state} = loadCreate();
    await create({name: 'Storefront', creationDate: new Date('1999-01-01T00:00:00Z')});
    // A caller-supplied creationDate would put a project at the front of the resolver's
    // "oldest wins" order and let it capture ingest aimed at an older duplicate.
    expect(state.inserted[0].creationDate instanceof Date).toBe(true);
    expect(state.inserted[0].creationDate.getUTCFullYear()).toBeGreaterThan(2000);
  });

  it('builds the document through setRelatedUsers, as the client path did', async () => {
    const {create, state} = loadCreate();
    await create({name: 'Storefront'});
    expect(state.relatedUsersCalls.length).toEqual(1);
    expect(state.relatedUsersCalls[0].userId).toEqual(MANAGER._id);
    expect(state.inserted[0].relatedUsers).toEqual({
      defaultProjectManager: MANAGER._id, defaultComplianceManager: null, members: []
    });
  });
});

describe('Projects.Create refuses a duplicate name', () => {
  it('answers 409 when the trimmed name is already taken', async () => {
    const {create, state} = loadCreate({existingNames: ['Storefront']});

    const error = await rejection(create({name: '  Storefront  '}));

    expect(error.error).toEqual(409);
    expect(error.reason).toEqual('A project with this name already exists');
    expect(state.inserted).toEqual([]);
    // A refused create is not an event worth an audit entry, and writing one would put a
    // "New project ... created" line in the log for a project that does not exist.
    expect(state.logEvents).toEqual([]);
  });

  it('the 409 is reached through the SHARED resolver, scoped to the caller company', async () => {
    const {create, state} = loadCreate({existingNames: ['Storefront']});
    await rejection(create({name: 'Storefront'}));
    expect(state.lookups).toEqual([{companyId: COMPANY, name: 'Storefront', fields: {_id: 1}}]);
  });

  it('does not refuse a name that only differs by case', async () => {
    // Trim-only normalisation, so `storefront` and `Storefront` stay two names. The rule has
    // to match the resolver's, which matches exactly and case-sensitively.
    const {create, state} = loadCreate({existingNames: ['Storefront']});
    const result = await create({name: 'storefront'});
    expect(result.name).toEqual('storefront');
    expect(state.inserted.length).toEqual(1);
  });
});

describe('Projects.Create with uniqueSuffix walks to the first free name', () => {
  it('appends " 2" when the bare name is taken', async () => {
    const {create, state} = loadCreate({existingNames: ['New project']});

    const result = await create({name: 'New project', uniqueSuffix: true});

    expect(result.name).toEqual('New project 2');
    expect(state.inserted[0].name).toEqual('New project 2');
    expect(state.lookups.map((l) => l.name)).toEqual(['New project', 'New project 2']);
  });

  it('keeps counting past a run of taken suffixes', async () => {
    const {create, state} = loadCreate({
      existingNames: ['New project', 'New project 2', 'New project 3', 'New project 4']
    });

    const result = await create({name: '  New project  ', uniqueSuffix: true});

    expect(result.name).toEqual('New project 5');
    expect(state.inserted[0].name).toEqual('New project 5');
    expect(state.lookups.length).toEqual(5);
  });

  it('returns the STORED name, which is what the caller has to navigate to', async () => {
    const {create} = loadCreate({existingNames: ['New project']});
    const result = await create({name: 'New project', uniqueSuffix: true});
    // The caller asked for "New project" and got a different project. Returning the name it
    // was actually stored under is the only way the caller can show the truth.
    expect(result).toEqual({projectId: 'new-project-1', name: 'New project 2'});
  });

  it('uses the bare name when it is free, with no suffix and one lookup', async () => {
    const {create, state} = loadCreate();
    const result = await create({name: 'New project', uniqueSuffix: true});
    expect(result.name).toEqual('New project');
    expect(state.lookups.length).toEqual(1);
  });

  it('answers 500 rather than searching forever when every suffix is taken', async () => {
    const names = ['Busy'];
    for (let i = 2; i <= 200; i++) { names.push('Busy ' + i); }
    const {create, state} = loadCreate({existingNames: names});

    const error = await rejection(create({name: 'Busy', uniqueSuffix: true}));

    expect(error.error).toEqual(500);
    expect(error.reason).toEqual('Could not create project');
    expect(state.inserted).toEqual([]);
    // Bounded: the search must not turn one click into an unbounded run of reads.
    expect(state.lookups.length).toBeLessThanOrEqual(50);
  });

  it('still answers 409 for a taken name when uniqueSuffix is not set', async () => {
    for (const flag of [undefined, false, 'yes', 1]) {
      const {create} = loadCreate({existingNames: ['Storefront']});
      const error = await rejection(create({name: 'Storefront', uniqueSuffix: flag}));
      // Anything but a real `true` means "I want this exact name" - a truthy string from a
      // hand-rolled DDP client must not silently opt into a different project.
      expect(error.error).toEqual(409);
    }
  });
});

describe('Projects.Create reports the write it actually made', () => {
  it('returns the new id and the stored name, and logs exactly one event', async () => {
    const {create, state} = loadCreate();

    const result = await create({name: '  Storefront  '});

    expect(result).toEqual({projectId: 'new-project-1', name: 'Storefront'});
    expect(state.logEvents.length).toEqual(1);
    expect(state.logEvents[0].type).toEqual('projectCreated');
    // The audit entry names the STORED project, so a uniqueSuffix rename is auditable.
    expect(state.logEvents[0].message).toContain('Storefront');
    expect(state.logEvents[0].user).toBe(MANAGER);
  });

  it('logs the name it stored, not the name it was asked for', async () => {
    const {create, state} = loadCreate({existingNames: ['New project']});
    await create({name: 'New project', uniqueSuffix: true});
    expect(state.logEvents.length).toEqual(1);
    expect(state.logEvents[0].message).toContain('New project 2');
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['an empty string', '']
  ])('answers 500 when the insert returns %s instead of an id', async (_label, insertId) => {
    const {create, state} = loadCreate({insertId: insertId});

    const error = await rejection(create({name: 'Storefront'}));

    expect(error.error).toEqual(500);
    expect(error.reason).toEqual('Could not create project');
    // No audit entry for a create that produced nothing.
    expect(state.logEvents).toEqual([]);
  });
});
