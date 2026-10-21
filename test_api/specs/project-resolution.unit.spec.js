/* eslint-disable no-undef */
// `POST /api/v2/core/projects` inserted unconditionally, so re-posting a name that
// already existed built a SECOND project beside the first one. Every ingest endpoint then
// picked between the duplicates its own way - `projects[0]` in scans.js, an unordered
// `findOneAsync` in moduleResolver.js and in check.js - so whichever row Mongo happened to
// hand back first won. A scan and a SARIF upload naming the same project could therefore
// land under two different rows, which is the mechanism behind the pair of specs in
// scans.spec.js failing on a re-run.
//
// projectResolver.js is now the single answer to "which project does this name mean inside
// this company". The rule it has to keep is asserted here against the REAL production
// source, loaded with stubbed Meteor imports (see helpers/loadMeteorModule): scoped to the
// caller's company, an `_id` match authoritative, otherwise the OLDEST row wins, and exactly
// one warning emitted from the one place that actually had to choose.
//
// THE COMPARATOR HAS TO LIVE IN JAVASCRIPT for any of this to mean anything. The in-memory
// collection below ignores a Mongo `{sort}` option - exactly as the fake in
// module-resolution.unit.spec.js does, and exactly as any fake would - so a resolver that
// delegated ordering to the database would get insertion order back, and the shuffled-order
// cases would pass while testing nothing.
const {loadMeteorModule, readSourceWithoutComments} = require('../helpers/loadMeteorModule');

// Loaded for real rather than stubbed - the resolver trims the name it is asked for,
// and a stub that always agreed would hide that. project-name-normalization.
// unit.spec.js owns the trim's own assertions.
const projectNameModule = loadMeteorModule('imports/lib/project/projectName.js', {});

// --- a minimal in-memory Mongo ---------------------------------------------------------
function matches(doc, selector) {
  return Object.keys(selector).every(function (key) {
    const value = selector[key];
    if (key === '$and') { return value.every(function (sub) { return matches(doc, sub); }); }
    if (key === '$or') { return value.some(function (sub) { return matches(doc, sub); }); }
    return doc[key] === value;
  });
}

// Inclusive projection, `_id` retained unless explicitly excluded - what Mongo does. It is
// applied for real so that a resolver which forwarded a caller's `{_id: 1}` verbatim would
// lose `creationDate` here and start choosing by row order.
function applyProjection(doc, fields) {
  const out = {};
  Object.keys(doc).forEach(function (key) {
    if (fields[key] || (key === '_id' && fields._id !== 0)) { out[key] = doc[key]; }
  });
  return out;
}

function fakeProjects(docs) {
  const state = {docs: docs || [], queries: []};
  return {
    state: state,
    find: function (selector, options) {
      state.queries.push({selector: selector, options: options});
      let found = state.docs.filter(function (doc) { return matches(doc, selector); });
      const fields = options && options.fields;
      if (fields) { found = found.map(function (doc) { return applyProjection(doc, fields); }); }
      return {fetchAsync: async function () { return found; }};
    },
    findOneAsync: async function (selector) {
      const query = typeof selector === 'string' ? {_id: selector} : selector;
      state.queries.push({selector: query, options: null});
      return state.docs.filter(function (doc) { return matches(doc, query); })[0] || null;
    }
  };
}

function loadProjectResolver(projects) {
  return loadMeteorModule('imports/server/rest-api/projectResolver.js', {
    '/imports/lib/collections/projects': {default: projects},
    '/imports/lib/security/sanitizeQuery': {asString: function (v) {
      return typeof v === 'string' ? v : undefined;
    }},
    // The REAL trim, not a stub: normalisation on the read side is
    // part of what these specs cover, and a stub that always agreed would hide it.
    '/imports/lib/project/projectName': projectNameModule
  });
}

/** Run `fn` with console.warn captured, so both directions of the warning are assertable. */
async function captureWarnings(fn) {
  const warnings = [];
  const real = console.warn;
  console.warn = function () { warnings.push(Array.prototype.join.call(arguments, ' ')); };
  try {
    const result = await fn();
    return {result: result, warnings: warnings};
  } finally {
    console.warn = real;
  }
}

const COMPANY = 'company-1';
const NAME = 'Storefront';

// `_id` ascending is p-a, p-b, p-c; `creationDate` ascending is p-c (none at all), p-b, p-a.
// Every expected winner below therefore differs from both the id order and, once the input
// is shuffled, from insertion order.
const NEWEST = {_id: 'p-a', companyId: COMPANY, name: NAME, creationDate: new Date('2024-03-01T00:00:00Z')};
const OLDEST = {_id: 'p-b', companyId: COMPANY, name: NAME, creationDate: new Date('2024-01-01T00:00:00Z')};
const UNDATED = {_id: 'p-c', companyId: COMPANY, name: NAME};

const ORDERS = [
  [NEWEST, OLDEST, UNDATED],
  [UNDATED, NEWEST, OLDEST],
  [OLDEST, UNDATED, NEWEST],
  [OLDEST, NEWEST, UNDATED]
];

describe('findProjectByName resolves a duplicated name the same way every time (issue #136)', () => {
  it.each(ORDERS.map((order, index) => [index, order]))(
    'picks the same project whatever order the database returns them in (order %i)',
    async (_index, order) => {
      const projects = fakeProjects(order.slice());
      const {findProjectByName} = loadProjectResolver(projects);

      const project = await findProjectByName({companyId: COMPANY, name: NAME});

      // A project with no recorded creationDate counts as the oldest - deliberately the same
      // order an ascending BSON sort produces, so pushing the sort into the query later
      // would not move the winner.
      expect(project._id).toEqual('p-c');
    });

  it('the oldest creationDate wins when every candidate has one', async () => {
    for (const order of [[NEWEST, OLDEST], [OLDEST, NEWEST]]) {
      const {findProjectByName} = loadProjectResolver(fakeProjects(order.slice()));
      const project = await findProjectByName({companyId: COMPANY, name: NAME});
      expect(project._id).toEqual('p-b');
    }
  });

  it('equal creationDates fall through to the id, never to row order', async () => {
    const sameDate = new Date('2024-02-02T00:00:00Z');
    const late = {_id: 'p-z', companyId: COMPANY, name: NAME, creationDate: sameDate};
    const early = {_id: 'p-a', companyId: COMPANY, name: NAME, creationDate: sameDate};

    for (const order of [[late, early], [early, late]]) {
      const {findProjectByName} = loadProjectResolver(fakeProjects(order.slice()));
      const project = await findProjectByName({companyId: COMPANY, name: NAME});
      expect(project._id).toEqual('p-a');
    }
  });

  it('keeps the sort keys even when the caller projects them away', async () => {
    // A caller asking only for `{_id: 1}` must not silently get a different winner: without
    // creationDate the comparator would see two undated rows and answer p-a.
    const projects = fakeProjects([NEWEST, OLDEST]);
    const {findProjectByName} = loadProjectResolver(projects);

    const project = await findProjectByName({companyId: COMPANY, name: NAME, fields: {_id: 1}});

    expect(project._id).toEqual('p-b');
  });

  it('never returns a same-named project belonging to another company', async () => {
    const foreign = {_id: 'p-foreign', companyId: 'company-2', name: NAME,
      creationDate: new Date('2000-01-01T00:00:00Z')};

    const onlyForeign = loadProjectResolver(fakeProjects([foreign]));
    expect(await onlyForeign.findProjectByName({companyId: COMPANY, name: NAME})).toBeNull();

    // ...and an older foreign row does not win over the caller's own.
    const mixed = loadProjectResolver(fakeProjects([foreign, OLDEST, NEWEST]));
    const project = await mixed.findProjectByName({companyId: COMPANY, name: NAME});
    expect(project._id).toEqual('p-b');
  });

  it('scopes every query it issues to the caller company', async () => {
    const projects = fakeProjects([OLDEST]);
    const {findProjectByName} = loadProjectResolver(projects);

    await findProjectByName({companyId: COMPANY, name: NAME});

    expect(projects.state.queries.length).toBeGreaterThan(0);
    projects.state.queries.forEach(function (query) {
      expect(query.selector.companyId).toEqual(COMPANY);
    });
  });

  it('matches the name exactly and case-sensitively', async () => {
    const {findProjectByName} = loadProjectResolver(fakeProjects([OLDEST]));
    expect(await findProjectByName({companyId: COMPANY, name: 'storefront'})).toBeNull();
    expect(await findProjectByName({companyId: COMPANY, name: 'Store'})).toBeNull();
  });

  it('does not resolve a name against a project whose _id happens to equal it', async () => {
    // findProjectByNameOrId is the one that accepts either; a plain name lookup must not.
    const {findProjectByName} = loadProjectResolver(
      fakeProjects([{_id: NAME, companyId: COMPANY, name: 'Something Else'}]));

    expect(await findProjectByName({companyId: COMPANY, name: NAME})).toBeNull();
  });

  it.each([
    ['undefined', undefined],
    ['an empty string', ''],
    ['a number', 42],
    ['a Mongo operator object', {$ne: ''}]
  ])('answers null WITHOUT querying when the name is %s', async (_label, name) => {
    const projects = fakeProjects([OLDEST]);
    const {findProjectByName} = loadProjectResolver(projects);

    expect(await findProjectByName({companyId: COMPANY, name: name})).toBeNull();
    expect(projects.state.queries.length).toEqual(0);
  });
});

describe('the warning is emitted exactly when the tie-break had to choose', () => {
  it('says nothing when one project carries the name', async () => {
    const {findProjectByName} = loadProjectResolver(fakeProjects([OLDEST]));

    const {result, warnings} = await captureWarnings(
      () => findProjectByName({companyId: COMPANY, name: NAME}));

    expect(result._id).toEqual('p-b');
    expect(warnings).toEqual([]);
  });

  it('says nothing when the name matches nothing at all', async () => {
    const {findProjectByName} = loadProjectResolver(fakeProjects([OLDEST]));

    const {result, warnings} = await captureWarnings(
      () => findProjectByName({companyId: COMPANY, name: 'No Such Project'}));

    expect(result).toBeNull();
    expect(warnings).toEqual([]);
  });

  it('warns once, naming the company, the name, the count and the chosen id', async () => {
    const {findProjectByName} = loadProjectResolver(fakeProjects(ORDERS[0].slice()));

    const {result, warnings} = await captureWarnings(
      () => findProjectByName({companyId: COMPANY, name: NAME}));

    expect(result._id).toEqual('p-c');
    expect(warnings.length).toEqual(1);
    expect(warnings[0]).toContain(COMPANY);
    expect(warnings[0]).toContain(NAME);
    expect(warnings[0]).toContain('3');
    expect(warnings[0]).toContain('p-c');
  });
});

describe('findProjectByNameOrId treats an id as authoritative (issue #136)', () => {
  // A caller that supplies an id identifies exactly one row, so there is no tie to break -
  // even when another project is NAMED after that id.
  const namedAfterAnId = {_id: 'p-y', companyId: COMPANY, name: 'p-x',
    creationDate: new Date('2020-01-01T00:00:00Z')};
  const addressedById = {_id: 'p-x', companyId: COMPANY, name: 'Something Else',
    creationDate: new Date('2025-01-01T00:00:00Z')};

  it('an id match wins over an older name match, and warns about nothing', async () => {
    const {findProjectByNameOrId} = loadProjectResolver(
      fakeProjects([namedAfterAnId, addressedById]));

    const {result, warnings} = await captureWarnings(
      () => findProjectByNameOrId({companyId: COMPANY, nameOrId: 'p-x'}));

    expect(result._id).toEqual('p-x');
    expect(warnings).toEqual([]);
  });

  it.each(ORDERS.map((order, index) => [index, order]))(
    'falls back to the oldest name match when no id matches (order %i)',
    async (_index, order) => {
      const {findProjectByNameOrId} = loadProjectResolver(fakeProjects(order.slice()));

      const project = await findProjectByNameOrId({companyId: COMPANY, nameOrId: NAME});

      expect(project._id).toEqual('p-c');
    });

  it('never resolves an id belonging to another company', async () => {
    const {findProjectByNameOrId} = loadProjectResolver(
      fakeProjects([{_id: 'p-foreign', companyId: 'company-2', name: NAME}]));

    expect(await findProjectByNameOrId({companyId: COMPANY, nameOrId: 'p-foreign'})).toBeNull();
    expect(await findProjectByNameOrId({companyId: COMPANY, nameOrId: NAME})).toBeNull();
  });

  it('answers null WITHOUT querying when the reference is not a usable string', async () => {
    const projects = fakeProjects([OLDEST]);
    const {findProjectByNameOrId} = loadProjectResolver(projects);

    expect(await findProjectByNameOrId({companyId: COMPANY, nameOrId: {$ne: ''}})).toBeNull();
    expect(await findProjectByNameOrId({companyId: COMPANY, nameOrId: ''})).toBeNull();
    expect(projects.state.queries.length).toEqual(0);
  });
});

// --- where the idempotency lookup sits in handlePost ------------------------------------
// The create arm needs a running app to exercise (projects-idempotent-create.spec.js does
// that), but WHERE the lookup sits is the whole of its security argument and is a property
// of the source: authorize first, validate second, look up third. Asserted here so it holds
// on any machine, with or without an app.
describe('the idempotent create arm authorizes and validates before it looks anything up', () => {
  const projectsSrc = readSourceWithoutComments('imports/server/rest-api/projects.js');
  const start = projectsSrc.indexOf('async function handlePost(');
  const handlePostBody = projectsSrc.slice(start,
    projectsSrc.indexOf('\nfunction createOKResponse('));

  it('slicing found the handler (guards every ordering assertion below)', () => {
    expect(start).toBeGreaterThan(-1);
    expect(handlePostBody).toContain('findProjectByName(');
  });

  it.each([
    ['the API key is resolved', 'RestApi.getKeyMetaAndCompanyByAccountAndApiKey('],
    ['the key scope is checked', 'Utils.validateKeyScope(keyMetaAndCompany.keyMeta, PROJECT_POST_ROLES)'],
    ['the body is cleaned and validated', 'helpers.cleanAndValidateProject(project)']
  ])('%s before the name is looked up', (_label, marker) => {
    const at = handlePostBody.indexOf(marker);
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(handlePostBody.indexOf('findProjectByName('));
  });

  it('an out-of-scope key returns before the lookup, so 403 is not a project-name oracle', () => {
    const refusal = handlePostBody.match(/!Utils\.validateKeyScope\([\s\S]{0,200}?return;/);
    expect(refusal).not.toBeNull();
    expect(handlePostBody.indexOf(refusal[0]))
      .toBeLessThan(handlePostBody.indexOf('findProjectByName('));
  });

  it('looks the name up in the AUTHENTICATED company, never the one on the body', () => {
    const lookup = handlePostBody.match(/findProjectByName\(\{[\s\S]*?\}\)/);
    expect(lookup).not.toBeNull();
    expect(lookup[0]).toMatch(/companyId:\s*keyMetaAndCompany\.company\._id/);
    expect(lookup[0]).toMatch(/name:\s*project\.name/);
    expect(lookup[0]).not.toMatch(/project\.companyId/);
  });

  it('answers 200 with the existing id and inserts nothing', () => {
    const existingArm = handlePostBody.slice(handlePostBody.indexOf('if (existing)'));
    expect(existingArm).toMatch(/response\.statusCode = 200;/);
    expect(existingArm).toMatch(/createOKResponse\(existing\._id,\s*true\)/);
    // The return is what keeps the insert below unreachable for an existing name.
    expect(existingArm.indexOf('return;'))
      .toBeLessThan(existingArm.indexOf('Projects.insertAsync('));
  });

  it('a real create still answers 201 with the unchanged body shape', () => {
    expect(handlePostBody).toMatch(/response\.statusCode = 201;[\s\S]{0,120}createOKResponse\(projectId\)/);
  });
});

// ========================================================================================
// Adversarial cases
//
// Everything above feeds the resolver well-formed rows: a `creationDate` is either a real
// Date or absent, a name is present, `_id`s are distinct. Production rows are not that
// tidy. `creationDate` is optional in ProjectSchema and these documents have been written
// by years of REST clients, imports and migrations, so the comparator can be handed a
// string, a number, a null or an invalid Date - and the ONE property the whole fix rests on
// is that the winner does not depend on the order Mongo returned the rows in. A comparator
// that answers "unordered" for a pair (which is what comparing a Date to a string with `<`
// does) silently reinstates row order, which is the exact defect this fix removed.
//
// So each case below is asserted over SHUFFLED input and compared against itself, not just
// against an expected id: the failure that matters is disagreement between orders.
// ========================================================================================

/** Resolve the same candidate set in several orders; returns the set of winners seen. */
async function winnersAcrossOrders(docs, resolve) {
  const orders = [docs, docs.slice().reverse(), docs.slice(1).concat(docs.slice(0, 1))];
  const winners = [];
  for (const order of orders) {
    const {findProjectByName, findProjectByNameOrId} = loadProjectResolver(fakeProjects(order.slice()));
    const project = await resolve({findProjectByName, findProjectByNameOrId});
    winners.push(project && project._id);
  }
  return winners;
}

describe('a creationDate that is not a Date still orders deterministically', () => {
  // `creationTime` only trusts `instanceof Date`; anything else counts as "no date", which
  // sorts FIRST. That is a deliberate choice rather than an accident, and it is asserted
  // here so it cannot be "tidied" into a `new Date(value)` coercion - which would make the
  // comparator's answer depend on whether a given row happened to be parseable.
  it.each([
    ['an ISO string', '2023-01-01T00:00:00Z'],
    ['an epoch number', 1672531200000],
    ['null', null],
    ['an invalid Date', new Date('not a date')],
    ['an empty object', {}]
  ])('%s is treated as undated, so that row wins over a real Date', async (_label, value) => {
    const untyped = {_id: 'p-untyped', companyId: COMPANY, name: NAME, creationDate: value};

    const winners = await winnersAcrossOrders([untyped, OLDEST, NEWEST],
      ({findProjectByName}) => findProjectByName({companyId: COMPANY, name: NAME}));

    expect(new Set(winners).size).toEqual(1);
    expect(winners[0]).toEqual('p-untyped');
  });

  it('several undated rows fall through to the id rather than to row order', async () => {
    // One undated row is decided by being undated; TWO are decided by the id tie-break, and
    // only this case exercises it for undated rows.
    const rows = [
      {_id: 'p-c', companyId: COMPANY, name: NAME},
      {_id: 'p-a', companyId: COMPANY, name: NAME, creationDate: 'sometime in 2019'},
      {_id: 'p-b', companyId: COMPANY, name: NAME, creationDate: null}
    ];

    const winners = await winnersAcrossOrders(rows,
      ({findProjectByName}) => findProjectByName({companyId: COMPANY, name: NAME}));

    expect(new Set(winners).size).toEqual(1);
    expect(winners[0]).toEqual('p-a');
  });

  it('ids tie-break as whole strings, so a shared prefix is not a numeric comparison', async () => {
    // 'p-1' < 'p-10' < 'p-2' lexicographically, which is NOT numeric order. Pinned because
    // "p-10 should sort after p-2" looks like a bug worth fixing, and fixing it would change
    // which project a duplicated name resolves to on live data.
    const sameDate = new Date('2024-02-02T00:00:00Z');
    const rows = ['p-2', 'p-10', 'p-1'].map((id) => (
      {_id: id, companyId: COMPANY, name: NAME, creationDate: sameDate}));

    const winners = await winnersAcrossOrders(rows,
      ({findProjectByName}) => findProjectByName({companyId: COMPANY, name: NAME}));

    expect(new Set(winners).size).toEqual(1);
    expect(winners[0]).toEqual('p-1');
  });
});

describe('a project row with no name at all', () => {
  const NAMELESS = {_id: 'p-nameless', companyId: COMPANY,
    creationDate: new Date('2000-01-01T00:00:00Z')};

  it('is never the answer to a name lookup, however old it is', async () => {
    // `name` is required by ProjectSchema, but rows predating it exist and this row is older
    // than every other candidate - so a selector that matched it would win the tie-break.
    const {findProjectByName} = loadProjectResolver(fakeProjects([NAMELESS, OLDEST]));

    const project = await findProjectByName({companyId: COMPANY, name: NAME});

    expect(project._id).toEqual('p-b');
  });

  it('is still reachable by its id', async () => {
    const {findProjectByNameOrId} = loadProjectResolver(fakeProjects([NAMELESS, OLDEST]));

    const project = await findProjectByNameOrId({companyId: COMPANY, nameOrId: 'p-nameless'});

    expect(project._id).toEqual('p-nameless');
  });
});

describe('a name that is also somebody\'s _id', () => {
  // `POST /scans` takes ONE `project` field and matches it as either. A company is free to
  // name a project after another project's id, and Mongo ids are just strings, so this is a
  // reachable state rather than a contrived one.
  const AMBIGUOUS = 'p-target';

  it('the id match wins even when several projects carry that name, and warns about nothing',
    async () => {
      // The developer-facing point: `resolveUnique` is never reached on the id path, so the
      // duplicate-name warning must stay silent - a warning here would be noise on every
      // single scan that addresses a project by id.
      const rows = [
        {_id: 'p-x', companyId: COMPANY, name: AMBIGUOUS, creationDate: new Date('2019-01-01Z')},
        {_id: 'p-y', companyId: COMPANY, name: AMBIGUOUS, creationDate: new Date('2020-01-01Z')},
        {_id: AMBIGUOUS, companyId: COMPANY, name: 'Something Else',
          creationDate: new Date('2025-01-01Z')}
      ];

      for (const order of [rows, rows.slice().reverse()]) {
        const {findProjectByNameOrId} = loadProjectResolver(fakeProjects(order.slice()));
        const {result, warnings} = await captureWarnings(
          () => findProjectByNameOrId({companyId: COMPANY, nameOrId: AMBIGUOUS}));

        expect(result._id).toEqual(AMBIGUOUS);
        expect(warnings).toEqual([]);
      }
    });

  it('a project named after its own id is matched once, not treated as a tie', async () => {
    const selfNamed = {_id: AMBIGUOUS, companyId: COMPANY, name: AMBIGUOUS};
    const {findProjectByNameOrId} = loadProjectResolver(fakeProjects([selfNamed]));

    const {result, warnings} = await captureWarnings(
      () => findProjectByNameOrId({companyId: COMPANY, nameOrId: AMBIGUOUS}));

    expect(result._id).toEqual(AMBIGUOUS);
    expect(warnings).toEqual([]);
  });

  it('another company owning that id does not shadow the caller\'s own project', async () => {
    // The dangerous direction: company-2's `_id` is company-1's project NAME. If the id arm
    // ran before the tenant filter, company-1 would be handed a foreign row.
    const foreignById = {_id: AMBIGUOUS, companyId: 'company-2', name: 'Foreign'};
    const mine = {_id: 'p-mine', companyId: COMPANY, name: AMBIGUOUS};

    const {findProjectByNameOrId} = loadProjectResolver(fakeProjects([foreignById, mine]));

    const project = await findProjectByNameOrId({companyId: COMPANY, nameOrId: AMBIGUOUS});

    expect(project._id).toEqual('p-mine');
  });
});

describe('findProjectByNameOrId keeps the guarantees findProjectByName was asserted to keep', () => {
  // The two exported functions share findCandidates but not their call sites, and the suite
  // above checks projection and tenant scoping only through findProjectByName. A regression
  // in the id-taking arm is the one an ingest path would actually hit.
  it('scopes every query it issues to the caller company', async () => {
    const projects = fakeProjects([OLDEST]);
    const {findProjectByNameOrId} = loadProjectResolver(projects);

    await findProjectByNameOrId({companyId: COMPANY, nameOrId: NAME});

    expect(projects.state.queries.length).toBeGreaterThan(0);
    projects.state.queries.forEach((query) => expect(query.selector.companyId).toEqual(COMPANY));
  });

  it('merges the sort keys back into a caller projection that dropped them', async () => {
    const projects = fakeProjects([NEWEST, OLDEST]);
    const {findProjectByNameOrId} = loadProjectResolver(projects);

    const project = await findProjectByNameOrId(
      {companyId: COMPANY, nameOrId: NAME, fields: {name: 1}});

    expect(project._id).toEqual('p-b');
    expect(projects.state.queries[0].options.fields).toMatchObject({_id: 1, creationDate: 1});
  });

  it('survives a caller that explicitly EXCLUDES _id, which would break the id arm', async () => {
    // `{_id: 0}` is a legal Mongo projection and the one shape that cannot merely lose the
    // tie-break: without `_id` the `candidates.find(p => p._id === value)` id match can never
    // hit, so an id lookup would silently degrade into a name lookup.
    const projects = fakeProjects([
      {_id: 'p-x', companyId: COMPANY, name: 'p-target'},
      {_id: 'p-target', companyId: COMPANY, name: 'Something Else'}
    ]);
    const {findProjectByNameOrId} = loadProjectResolver(projects);

    const project = await findProjectByNameOrId(
      {companyId: COMPANY, nameOrId: 'p-target', fields: {_id: 0, name: 1}});

    expect(projects.state.queries[0].options.fields._id).toEqual(1);
    expect(project._id).toEqual('p-target');
  });

  it('does not mutate the projection object the caller passed in', async () => {
    // A module-level `const PROJECT_FIELDS = {_id: 1}` shared across calls would be corrupted
    // for every later caller if the merge wrote through it.
    const fields = {_id: 1};
    const {findProjectByNameOrId} = loadProjectResolver(fakeProjects([OLDEST]));

    await findProjectByNameOrId({companyId: COMPANY, nameOrId: NAME, fields});

    expect(fields).toEqual({_id: 1});
  });
});

describe('the duplicate-name warning stays one line however many duplicates there are', () => {
  it('warns once for five duplicates, not once per comparison', async () => {
    // `sort` calls the comparator O(n log n) times; a warning emitted from inside it would
    // put one line per comparison into the log of every ingest request.
    const rows = ['p-1', 'p-2', 'p-3', 'p-4', 'p-5'].map((id, index) => (
      {_id: id, companyId: COMPANY, name: NAME,
        creationDate: new Date(Date.UTC(2020 + index, 0, 1))}));

    const {findProjectByName} = loadProjectResolver(fakeProjects(rows));
    const {result, warnings} = await captureWarnings(
      () => findProjectByName({companyId: COMPANY, name: NAME}));

    expect(result._id).toEqual('p-1');
    expect(warnings.length).toEqual(1);
    expect(warnings[0]).toContain('5');
  });
});
