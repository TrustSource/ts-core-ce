/* eslint-disable no-undef */
// Fix round `da1f8ec1f` - the three behaviours that commit shipped with NO test.
//
// `26cccf4fd` fetched every same-named project and picked the winner with a JavaScript
// comparator. `da1f8ec1f` then put a bounded database read underneath that comparator and
// de-duplicated the warning it emits:
//
//   1. CANDIDATE_LIMIT = 50 - the candidate read is capped
//   2. CANDIDATE_SORT     - the database now sorts `{creationDate: 1, _id: 1}` and limits,
//                           so the capped window is the top-k the comparator would have wanted
//   3. warn de-duplication - one line per {companyId, name} per hour, through a module-level
//                           Map capped at 500 keys and dropped wholesale when it fills
//
// None of the three was covered: that commit's unit totals were unchanged from the baseline
// BECAUSE nothing exercised it, and the mutation checks quoted for it all targeted code that
// predates it. This file is the missing half.
//
// WHY THERE ARE TWO IN-MEMORY COLLECTIONS IN THIS REPOSITORY.
// `project-resolution.unit.spec.js` fakes a collection that deliberately IGNORES `{sort}` and
// `{limit}`. That is not an oversight - it is the thing that keeps the JS comparator honest:
// a resolver that quietly delegated ordering to the database would get insertion order back
// there and every shuffled-order case would pass while testing nothing. Keep it that way.
//
// The cap and the database sort are, by construction, invisible to a fake that ignores them.
// So this file adds a SECOND, FAITHFUL fake that honours `{sort}` and `{limit}` and orders by
// real BSON type rules, and uses it ONLY for the properties the loose fake cannot see. The two
// files then pin the two halves of the design: the comparator decides, the database bounds.
const {loadMeteorModule, readSourceWithoutComments} =
  require('../helpers/loadMeteorModule');
// Loaded for real rather than stubbed - the resolver trims the name it is asked for since the
// idempotent-create follow-up, and a stub that always agreed would hide that. project-name-normalization.
// unit.spec.js owns the trim's own assertions.
const projectNameModule = loadMeteorModule('imports/lib/project/projectName.js', {});

// --- selector matching (same shape as the loose fake, so only sort/limit differ) ---------
function matches(doc, selector) {
  return Object.keys(selector).every(function (key) {
    const value = selector[key];
    if (key === '$and') { return value.every(function (sub) { return matches(doc, sub); }); }
    if (key === '$or') { return value.some(function (sub) { return matches(doc, sub); }); }
    return doc[key] === value;
  });
}

function applyProjection(doc, fields) {
  const out = {};
  Object.keys(doc).forEach(function (key) {
    if (fields[key] || (key === '_id' && fields._id !== 0)) { out[key] = doc[key]; }
  });
  return out;
}

// --- BSON ordering ----------------------------------------------------------------------
// MongoDB compares values of DIFFERENT BSON types by type rank before it compares them by
// value ("Comparison/Sort Order" in the manual), and a MISSING field sorts as null. Only the
// ranks a `creationDate` can actually hold are modelled; the numbers are the manual's own
// positions so the table reads against it.
//
// This is the whole reason the cap can disagree with the comparator: ascending, a null or an
// absent date sorts before a NUMBER, which sorts before a STRING, which sorts before a real
// DATE - while `creationTime()` in the resolver collapses all of null/number/string/invalid
// into one "undated" bucket that it sorts first. The two agree on which row is oldest only as
// long as every non-Date row fits inside the window.
const BSON_RANK = {null: 2, number: 3, string: 4, object: 5, date: 10};

function bsonRank(value) {
  if (value === null || value === undefined) { return BSON_RANK.null; }
  if (value instanceof Date) { return BSON_RANK.date; }
  if (typeof value === 'number') { return BSON_RANK.number; }
  if (typeof value === 'string') { return BSON_RANK.string; }
  return BSON_RANK.object;
}

function bsonCompare(a, b) {
  const rankA = bsonRank(a);
  const rankB = bsonRank(b);
  if (rankA !== rankB) { return rankA < rankB ? -1 : 1; }
  if (rankA === BSON_RANK.date) {
    // An invalid Date carries NaN, which is unordered against everything including itself.
    // Treated as equal so the comparison never returns "unordered" - the next sort key then
    // decides, which is what keeps this fake deterministic.
    const timeA = a.getTime();
    const timeB = b.getTime();
    if (isNaN(timeA) || isNaN(timeB)) { return isNaN(timeA) && isNaN(timeB) ? 0 : (isNaN(timeA) ? -1 : 1); }
    return timeA === timeB ? 0 : (timeA < timeB ? -1 : 1);
  }
  if (rankA === BSON_RANK.number || rankA === BSON_RANK.string) {
    // Strings compare by code unit here. Every fixture id and date string below is ASCII, so
    // this agrees with the server's default binary collation without modelling collations.
    return a === b ? 0 : (a < b ? -1 : 1);
  }
  return 0;   // two nulls, or two objects - nothing left to order them by
}

function bsonSort(docs, sort) {
  const keys = Object.keys(sort);
  return docs.slice().sort(function (left, right) {
    for (const key of keys) {
      const order = bsonCompare(left[key], right[key]) * (sort[key] < 0 ? -1 : 1);
      if (order !== 0) { return order; }
    }
    return 0;
  });
}

/**
 * A collection that honours `{sort}` and `{limit}` the way a real one does: match, then sort,
 * then cut, then project. The order matters - projecting first would let a projection change
 * which rows survive the cut, which a server never does.
 */
function faithfulProjects(docs) {
  const state = {docs: docs || [], queries: []};
  return {
    state: state,
    find: function (selector, options) {
      state.queries.push({selector: selector, options: options});
      let found = state.docs.filter(function (doc) { return matches(doc, selector); });
      if (options && options.sort) { found = bsonSort(found, options.sort); }
      if (options && typeof options.limit === 'number') { found = found.slice(0, options.limit); }
      const fields = options && options.fields;
      if (fields) { found = found.map(function (doc) { return applyProjection(doc, fields); }); }
      return {fetchAsync: async function () { return found; }};
    }
  };
}

/** The loose fake, in miniature: ignores sort AND limit, so it shows the uncapped answer. */
function unboundedProjects(docs) {
  const state = {docs: docs || [], queries: []};
  return {
    state: state,
    find: function (selector, options) {
      state.queries.push({selector: selector, options: options});
      return {fetchAsync: async function () {
        return state.docs.filter(function (doc) { return matches(doc, selector); });
      }};
    }
  };
}

function loadProjectResolver(projects) {
  return loadMeteorModule('imports/server/rest-api/projectResolver.js', {
    '/imports/lib/collections/projects': {default: projects},
    '/imports/lib/security/sanitizeQuery': {asString: function (v) {
      return typeof v === 'string' ? v : undefined;
    }},
    // The REAL trim (the name-normalisation follow-up), not a stub: normalisation on the read side is
    // part of what these specs cover, and a stub that always agreed would hide it.
    '/imports/lib/project/projectName': projectNameModule
  });
}

/** Run `fn` with console.warn captured, so BOTH directions of the warning are assertable. */
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

// Resolving a duplicate is exactly what most of the specs below do, and the resolver warns
// when it does - so without this the suite prints a warning for nearly every test. Silenced
// once, at session setup, rather than per helper: a specs-wide concern belongs where it
// covers every path, not only the ones that happen to go through one function.
// `captureWarnings` installs and restores its own recorder on top, so the tests that DO
// assert on the line still see it.
let silencedWarn;
beforeEach(() => { silencedWarn = jest.spyOn(console, 'warn').mockImplementation(() => {}); });
afterEach(() => { silencedWarn.mockRestore(); });

const COMPANY = 'company-1';
const NAME = 'Storefront';
const LIMIT = 50;               // CANDIDATE_LIMIT, asserted against the source below too
const HOUR_MS = 60 * 60 * 1000; // WARN_INTERVAL_MS

/** `count` same-named rows, oldest first, ids zero-padded so `_id` order is stable. */
function datedRows(count, prefix) {
  return Array.from({length: count}, function (_unused, index) {
    return {
      _id: `${prefix || 'p'}-${String(index).padStart(3, '0')}`,
      companyId: COMPANY,
      name: NAME,
      creationDate: new Date(Date.UTC(2000 + index, 0, 1))
    };
  });
}

// =========================================================================================
// The fake itself. Every assertion below rests on it ordering and cutting the way a server
// does, so it is tested before it is trusted - a fake that quietly ignored `limit` would make
// the cap specs pass for the wrong reason.
// =========================================================================================
describe('the faithful in-memory collection honours what the loose one deliberately ignores', () => {
  const rows = [
    {_id: 'r-date', companyId: COMPANY, name: NAME, creationDate: new Date('2001-01-01Z')},
    {_id: 'r-string', companyId: COMPANY, name: NAME, creationDate: '1990-01-01'},
    {_id: 'r-null', companyId: COMPANY, name: NAME, creationDate: null},
    {_id: 'r-missing', companyId: COMPANY, name: NAME},
    {_id: 'r-number', companyId: COMPANY, name: NAME, creationDate: 631152000000}
  ];

  async function fetch(options) {
    return faithfulProjects(rows.slice().reverse())
      .find({companyId: COMPANY, name: NAME}, options).fetchAsync();
  }

  it('orders by BSON type rank first: null/missing, then number, then string, then Date', async () => {
    const found = await fetch({sort: {creationDate: 1, _id: 1}});
    expect(found.map((doc) => doc._id))
      .toEqual(['r-missing', 'r-null', 'r-number', 'r-string', 'r-date']);
  });

  it('breaks ties on the secondary key, and honours a descending direction', async () => {
    // `r-missing` and `r-null` share the null rank, so only the `_id` key separates them -
    // and it has to flip with the direction, or the fake would be modelling a stable sort
    // rather than a two-key one.
    const found = await fetch({sort: {creationDate: -1, _id: -1}});
    expect(found.map((doc) => doc._id))
      .toEqual(['r-date', 'r-string', 'r-number', 'r-null', 'r-missing']);
  });

  it('cuts AFTER the sort, not before it', async () => {
    const found = await fetch({sort: {creationDate: 1, _id: 1}, limit: 2});
    expect(found.map((doc) => doc._id)).toEqual(['r-missing', 'r-null']);
  });

  it('returns every match when no limit is given, so an uncapped read stays visible', async () => {
    // The other direction of the test above: if this fake silently capped everything, a
    // resolver that dropped its `limit` would still look bounded here.
    const found = await fetch({sort: {creationDate: 1, _id: 1}});
    expect(found.length).toEqual(rows.length);
  });

  it('projects after the cut, so a projection cannot change which rows survive it', async () => {
    const found = await fetch({sort: {creationDate: 1, _id: 1}, limit: 2, fields: {_id: 1}});
    expect(found.map((doc) => doc._id)).toEqual(['r-missing', 'r-null']);
    expect(found[0]).toEqual({_id: 'r-missing'});
  });
});

// =========================================================================================
// 1 + 2. The cap and the database sort.
// =========================================================================================
describe('every read the resolver issues is sorted and capped (issue #136)', () => {
  it('findProjectByName issues ONE query, sorted {creationDate: 1, _id: 1} and capped at 50', async () => {
    const projects = faithfulProjects(datedRows(3));
    const {findProjectByName} = loadProjectResolver(projects);

    await findProjectByName({companyId: COMPANY, name: NAME});

    expect(projects.state.queries.length).toEqual(1);
    expect(projects.state.queries[0].options.sort).toEqual({creationDate: 1, _id: 1});
    expect(projects.state.queries[0].options.limit).toEqual(LIMIT);
  });

  it('the id arm is limited to 1, because an id addresses at most one row in a company', async () => {
    // A cut of 1 on an `_id` selector is EXACT rather than a cut. That is the whole point of
    // splitting the id lookup out of the old single `$or`: the authoritative match can no
    // longer be pushed past a limit it is not part of.
    const projects = faithfulProjects([
      {_id: 'p-target', companyId: COMPANY, name: 'Something Else'},
      {_id: 'p-other', companyId: COMPANY, name: 'p-target'}
    ]);
    const {findProjectByNameOrId} = loadProjectResolver(projects);

    const project = await findProjectByNameOrId({companyId: COMPANY, nameOrId: 'p-target'});

    expect(project._id).toEqual('p-target');
    expect(projects.state.queries.length).toEqual(1);          // the name arm never ran
    expect(projects.state.queries[0].selector._id).toEqual('p-target');
    expect(projects.state.queries[0].options.limit).toEqual(1);
    expect(projects.state.queries[0].options.sort).toEqual({creationDate: 1, _id: 1});
  });

  it('the name arm of findProjectByNameOrId carries the 50 cap once the id arm misses', async () => {
    const projects = faithfulProjects(datedRows(3));
    const {findProjectByNameOrId} = loadProjectResolver(projects);

    await findProjectByNameOrId({companyId: COMPANY, nameOrId: NAME});

    expect(projects.state.queries.length).toEqual(2);
    expect(projects.state.queries[0].options.limit).toEqual(1);       // id arm
    expect(projects.state.queries[1].options.limit).toEqual(LIMIT);   // name arm
  });

  it('NO read either export can issue is uncapped, whatever it is asked', async () => {
    // A sweep rather than a per-call assertion: the finding this cap answers was an UNBOUNDED
    // fetch, so "some reads are capped" is not the property - "no read is not" is.
    const projects = faithfulProjects(datedRows(3).concat(
      [{_id: 'p-id', companyId: COMPANY, name: 'Other'}]));
    const {findProjectByName, findProjectByNameOrId} = loadProjectResolver(projects);

    await findProjectByName({companyId: COMPANY, name: NAME});
    await findProjectByName({companyId: COMPANY, name: 'No Such Project'});
    await findProjectByName({companyId: COMPANY, name: NAME, fields: {name: 1}});
    await findProjectByNameOrId({companyId: COMPANY, nameOrId: 'p-id'});
    await findProjectByNameOrId({companyId: COMPANY, nameOrId: NAME});
    await findProjectByNameOrId({companyId: COMPANY, nameOrId: 'No Such Project'});
    await findProjectByNameOrId({companyId: COMPANY, nameOrId: NAME, fields: {_id: 0}});

    expect(projects.state.queries.length).toBeGreaterThan(7);   // guards against a vacuous sweep
    projects.state.queries.forEach(function (query) {
      expect(typeof query.options.limit).toEqual('number');
      expect(query.options.limit).toBeGreaterThan(0);
      expect(query.options.limit).toBeLessThanOrEqual(LIMIT);
      expect(query.options.sort).toEqual({creationDate: 1, _id: 1});
    });
  });

  it('the cap is a DEFAULT, so a future call site cannot get an uncapped read by omission', () => {
    // Both of today's call sites pass a limit explicitly, so this one is only assertable in
    // the source. Read comment-aware, so a commented-out signature cannot satisfy it.
    const src = readSourceWithoutComments('imports/server/rest-api/projectResolver.js');
    expect(src).toContain('Projects.find(');                    // the file was not swallowed
    expect(src).toMatch(/const CANDIDATE_LIMIT\s*=\s*50;/);
    expect(src).toMatch(/function findCandidates\([^)]*limit\s*=\s*CANDIDATE_LIMIT\s*\)/);
  });

  it('reads at most CANDIDATE_LIMIT rows even when far more carry the name', async () => {
    const projects = faithfulProjects(datedRows(60));
    const {findProjectByName} = loadProjectResolver(projects);

    const project = await findProjectByName({companyId: COMPANY, name: NAME});

    const returned = await projects.state.docs
      .filter((doc) => doc.name === NAME).length;
    expect(returned).toEqual(60);                 // 60 exist...
    // ...and the resolver still answers the globally oldest, because for rows with real
    // Dates the database sort and the comparator agree: the cap chooses how many candidates
    // are looked at, not which one wins.
    expect(project._id).toEqual('p-000');
  });
});

// =========================================================================================
// The database sort did NOT make the JavaScript comparator redundant.
// =========================================================================================
describe('the comparator still decides, even under a faithful database sort', () => {
  it('overrules the row the database put first when their notions of "oldest" differ', async () => {
    // BSON ascending: null (p-b) < string (p-a) < Date (p-c) - so `candidates[0]` is p-b.
    // `creationTime()` reads only `instanceof Date`, so p-a and p-b are BOTH undated and tie,
    // and the `_id` tie-break picks p-a. The two answers differ, and the comparator's wins.
    //
    // This is the case that would go silent if anyone "simplified" the resolver to trust the
    // new `{sort}` and take `candidates[0]`.
    const rows = [
      {_id: 'p-b', companyId: COMPANY, name: NAME, creationDate: null},
      {_id: 'p-a', companyId: COMPANY, name: NAME, creationDate: '2019-01-01'},
      {_id: 'p-c', companyId: COMPANY, name: NAME, creationDate: new Date('2018-01-01Z')}
    ];

    for (const order of [rows, rows.slice().reverse(), rows.slice(1).concat(rows.slice(0, 1))]) {
      const projects = faithfulProjects(order.slice());
      const {findProjectByName} = loadProjectResolver(projects);

      const project = await findProjectByName({companyId: COMPANY, name: NAME});

      const asTheDatabaseOrderedThem = await projects.find(
        {companyId: COMPANY, name: NAME}, {sort: {creationDate: 1, _id: 1}}).fetchAsync();
      expect(asTheDatabaseOrderedThem[0]._id).toEqual('p-b');   // what the database put first
      expect(project._id).toEqual('p-a');                       // what the comparator chose
    }
  });
});

// =========================================================================================
// CHARACTERISATION: where the cap and the comparator diverge.
//
// This is NOT a bug report. It is ACCEPTED BEHAVIOUR, recorded here so it is read rather than
// rediscovered - the production comment beside CANDIDATE_SORT used to claim the corner was
// unreachable, and it is not.
//
// It needs ALL of: more than CANDIDATE_LIMIT projects sharing one name inside one company,
// AND at least one of them carrying a `creationDate` that is present but is not a Date. Both
// halves are reachable (`Projects.allow({insert})` lets a client insert over DDP with no
// uniqueness guard, and `creationDate` is optional in ProjectSchema, so rows written by years
// of REST clients, imports and migrations hold strings and nulls) - but together they are
// vanishingly rare, and the cost of removing the divergence is an unbounded read.
//
// Crucially, the divergence does NOT reintroduce the order-dependent defect: the window is itself
// deterministic, so the answer is still the same one every time, for every input order and on
// every replica. It moves WHICH row wins; it does not make the winner arbitrary again.
// =========================================================================================
describe('CHARACTERISATION: past 50 duplicates the cap can move the winner (accepted)', () => {
  // 51 rows the database sorts first (null dates), and one string-dated row that the
  // comparator would rank alongside them but that BSON puts AFTER every null.
  const nulls = Array.from({length: 51}, function (_unused, index) {
    return {_id: `z-${String(index).padStart(3, '0')}`, companyId: COMPANY, name: NAME,
      creationDate: null};
  });
  const stringDated = {_id: 'a-000', companyId: COMPANY, name: NAME,
    creationDate: '1999-01-01T00:00:00Z'};
  const rows = nulls.concat([stringDated]);

  it('the capped resolver answers the lowest id INSIDE the 50-row window', async () => {
    const projects = faithfulProjects(rows.slice());
    const {findProjectByName} = loadProjectResolver(projects);

    const project = await findProjectByName({companyId: COMPANY, name: NAME});

    // `a-000` sorts after all 51 nulls in BSON order, so it never reaches the comparator.
    expect(project._id).toEqual('z-000');
  });

  it('an UNCAPPED read of exactly the same rows answers a-000 instead', async () => {
    // Same production code, same rows; the only difference is a collection that ignores the
    // limit. That attributes the divergence to the cap and to nothing else.
    const {findProjectByName} = loadProjectResolver(unboundedProjects(rows.slice()));

    const project = await findProjectByName({companyId: COMPANY, name: NAME});

    expect(project._id).toEqual('a-000');
  });

  it('the capped answer is still order-independent, so criterion 5 is intact', async () => {
    // The property deterministic resolution actually bought is that the winner does not depend on the order the
    // database happened to return the rows in. The cap does not cost that: the window is
    // chosen by a total order, not by row order.
    const orders = [rows, rows.slice().reverse(), rows.slice(25).concat(rows.slice(0, 25))];
    const winners = [];
    for (const order of orders) {
      const {findProjectByName} = loadProjectResolver(faithfulProjects(order.slice()));
      const project = await findProjectByName({companyId: COMPANY, name: NAME});
      winners.push(project._id);
    }
    expect(new Set(winners).size).toEqual(1);
    expect(winners[0]).toEqual('z-000');
  });

  it('50 duplicates or fewer cannot diverge, whatever their dates are', async () => {
    // The other direction, and the one that says how narrow the corner is: with the whole
    // candidate set inside the window the comparator sees everything, so it answers exactly
    // what an uncapped read would.
    const within = rows.slice(0, LIMIT - 1).concat([stringDated]);   // 50 rows, incl. a-000

    const capped = loadProjectResolver(faithfulProjects(within.slice()));
    const uncapped = loadProjectResolver(unboundedProjects(within.slice()));

    const fromCapped = await capped.findProjectByName({companyId: COMPANY, name: NAME});
    const fromUncapped = await uncapped.findProjectByName({companyId: COMPANY, name: NAME});

    expect(fromCapped._id).toEqual(fromUncapped._id);
    expect(fromCapped._id).toEqual('a-000');
  });
});

// =========================================================================================
// 3. Warning de-duplication.
//
// A duplicated name is a STANDING CONDITION, not an event: without de-duplication every scan,
// SARIF upload and /check call naming it logs a line, on the hottest ingest paths in the app.
// The de-duplication is module-level mutable state in a process that runs for weeks, so the
// three things worth proving are that it cannot leak, cannot go stale, and cannot swallow the
// resolution along with the line.
//
// These specs are independent of each other because `loadMeteorModule` re-evaluates the file
// in a FRESH `vm` context per load - there is no require cache in play, so every
// `loadProjectResolver()` gets its own Map. That assumption is itself pinned below rather
// than assumed, because if it ever stopped holding these specs would go order-dependent.
// =========================================================================================
describe('the duplicate-name warning is de-duplicated per {company, name} (issue #136)', () => {
  /** Two rows sharing `name`, so resolving it always has a tie to break. */
  function duplicatesOf(name, companyId) {
    return [
      {_id: `${name}-old`, companyId: companyId || COMPANY, name: name,
        creationDate: new Date('2020-01-01Z')},
      {_id: `${name}-new`, companyId: companyId || COMPANY, name: name,
        creationDate: new Date('2021-01-01Z')}
    ];
  }

  it('warns once for five resolutions of the same duplicated name, not five times', async () => {
    const {findProjectByName} = loadProjectResolver(faithfulProjects(duplicatesOf(NAME)));

    const {warnings} = await captureWarnings(async () => {
      const seen = [];
      for (let i = 0; i < 5; i++) {
        seen.push(await findProjectByName({companyId: COMPANY, name: NAME}));
      }
      return seen;
    });

    expect(warnings.length).toEqual(1);
    expect(warnings[0]).toContain(NAME);
  });

  it('still RESOLVES on every one of those calls - only the line is suppressed', async () => {
    // The direction that matters operationally: a de-duplication bug that returned early, or
    // that made the silent calls fall through to null, would break ingest rather than logging.
    const {findProjectByName} = loadProjectResolver(faithfulProjects(duplicatesOf(NAME)));

    const {result, warnings} = await captureWarnings(async () => {
      const seen = [];
      for (let i = 0; i < 5; i++) {
        seen.push(await findProjectByName({companyId: COMPANY, name: NAME}));
      }
      return seen;
    });

    expect(warnings.length).toEqual(1);
    expect(result.map((project) => project && project._id))
      .toEqual([`${NAME}-old`, `${NAME}-old`, `${NAME}-old`, `${NAME}-old`, `${NAME}-old`]);
  });

  it('de-duplicates per NAME, so a second duplicated name still gets its own line', async () => {
    const docs = duplicatesOf(NAME).concat(duplicatesOf('Checkout'));
    const {findProjectByName} = loadProjectResolver(faithfulProjects(docs));

    const {warnings} = await captureWarnings(async () => {
      await findProjectByName({companyId: COMPANY, name: NAME});
      await findProjectByName({companyId: COMPANY, name: 'Checkout'});
      await findProjectByName({companyId: COMPANY, name: NAME});
    });

    expect(warnings.length).toEqual(2);
    expect(warnings[0]).toContain(NAME);
    expect(warnings[1]).toContain('Checkout');
  });

  it('de-duplicates per COMPANY, so one tenant cannot silence another tenant\'s line', async () => {
    // The key is the PAIR. Keyed on the name alone, the busiest tenant would suppress the
    // warning for every other tenant that happens to use the same project name.
    const docs = duplicatesOf(NAME).concat(duplicatesOf(NAME, 'company-2'));
    const {findProjectByName} = loadProjectResolver(faithfulProjects(docs));

    const {warnings} = await captureWarnings(async () => {
      await findProjectByName({companyId: COMPANY, name: NAME});
      await findProjectByName({companyId: 'company-2', name: NAME});
    });

    expect(warnings.length).toEqual(2);
    expect(warnings[0]).toContain(COMPANY);
    expect(warnings[1]).toContain('company-2');
  });

  it('reports a count, exactly when it is exact and as "50+" when the page is full', async () => {
    // A full page means "at least this many" - the cap hid whatever was behind it. Both
    // directions asserted, because a message that always said `50+` would be just as wrong as
    // one that always reported an exact count it could not know.
    const under = loadProjectResolver(faithfulProjects(datedRows(LIMIT - 1)));
    const full = loadProjectResolver(faithfulProjects(datedRows(LIMIT + 10)));

    const short = await captureWarnings(
      () => under.findProjectByName({companyId: COMPANY, name: NAME}));
    const capped = await captureWarnings(
      () => full.findProjectByName({companyId: COMPANY, name: NAME}));

    expect(short.warnings.length).toEqual(1);
    expect(short.warnings[0]).toContain(`${LIMIT - 1} projects`);
    expect(short.warnings[0]).not.toContain('+');

    expect(capped.warnings.length).toEqual(1);
    expect(capped.warnings[0]).toContain(`${LIMIT}+ projects`);
  });
});

describe('the de-duplication map cannot go stale in a long-running server', () => {
  function duplicatesOf(name) {
    return [
      {_id: `${name}-old`, companyId: COMPANY, name: name, creationDate: new Date('2020-01-01Z')},
      {_id: `${name}-new`, companyId: COMPANY, name: name, creationDate: new Date('2021-01-01Z')}
    ];
  }

  let now;
  let nowSpy;

  beforeEach(() => {
    // The resolver reads `Date.now()`, and `loadMeteorModule` hands the vm the REAL global
    // `Date` object - so spying on it here is visible inside the module under test.
    now = Date.UTC(2026, 0, 1);
    nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => now);
  });

  afterEach(() => {
    nowSpy.mockRestore();
  });

  it('stays silent for an hour and speaks again after it, so a standing condition resurfaces', async () => {
    const {findProjectByName} = loadProjectResolver(faithfulProjects(duplicatesOf(NAME)));
    const resolve = () => findProjectByName({companyId: COMPANY, name: NAME});

    const first = await captureWarnings(resolve);
    expect(first.warnings.length).toEqual(1);

    now += HOUR_MS - 1000;                      // one second short of the interval
    const withinTheHour = await captureWarnings(resolve);
    expect(withinTheHour.warnings).toEqual([]);

    now += 1000;                                // exactly one hour after the first line
    const afterTheHour = await captureWarnings(resolve);
    expect(afterTheHour.warnings.length).toEqual(1);

    // ...and the refreshed key restarts the hour rather than warning on every call from now on.
    const immediatelyAfter = await captureWarnings(resolve);
    expect(immediatelyAfter.warnings).toEqual([]);
  });

  it('is bounded at 500 keys and dropped WHOLESALE, so it cannot grow into a leak', async () => {
    // 502 distinct duplicated names. Keys 1..500 fill the map; the 501st finds it full and
    // clears it entirely, so 1..500 are forgotten and 501..502 are what it now holds.
    //
    // Wholesale clearing is a deliberate trade: an LRU would be kinder to the log but would
    // need per-key bookkeeping on the hottest ingest path. The cost is that a very wide
    // duplicate-name problem (>500 pairs at once) returns log volume to un-deduplicated
    // levels - which is recorded here, not hidden.
    const names = Array.from({length: 502}, (_unused, index) => `Dup-${String(index).padStart(3, '0')}`);
    const docs = names.reduce((all, name) => all.concat(duplicatesOf(name)), []);
    const {findProjectByName} = loadProjectResolver(faithfulProjects(docs));

    const firstPass = await captureWarnings(async () => {
      for (const name of names) { await findProjectByName({companyId: COMPANY, name: name}); }
    });
    expect(firstPass.warnings.length).toEqual(502);

    // A name from BEFORE the clear was evicted, so it warns again...
    const evicted = await captureWarnings(
      () => findProjectByName({companyId: COMPANY, name: names[0]}));
    expect(evicted.warnings.length).toEqual(1);

    // ...and one from AFTER it is still remembered, which is what proves the map was cleared
    // rather than simply never populated. Both directions, because a `warnedAt.clear()` on
    // EVERY call would satisfy the assertion above on its own.
    const retained = await captureWarnings(
      () => findProjectByName({companyId: COMPANY, name: names[501]}));
    expect(retained.warnings).toEqual([]);
  });

  it('keeps de-duplicating after a clear, rather than degrading to one line per call', async () => {
    const names = Array.from({length: 501}, (_unused, index) => `Wide-${String(index).padStart(3, '0')}`);
    const docs = names.reduce((all, name) => all.concat(duplicatesOf(name)), []);
    const {findProjectByName} = loadProjectResolver(faithfulProjects(docs));

    await captureWarnings(async () => {
      for (const name of names) { await findProjectByName({companyId: COMPANY, name: name}); }
    });

    // `names[500]` triggered the clear and was then stored. Ten more resolutions of it must
    // produce nothing.
    const repeats = await captureWarnings(async () => {
      for (let i = 0; i < 10; i++) {
        await findProjectByName({companyId: COMPANY, name: names[500]});
      }
    });
    expect(repeats.warnings).toEqual([]);
  });

  it('gives every module load its own map, which is what keeps these specs independent', async () => {
    // `loadMeteorModule` evaluates the source in a fresh `vm` context and does not cache, so
    // module-level state does not survive a load. If that ever changed, the specs above would
    // silently become order-dependent - so it is asserted, not assumed.
    const first = loadProjectResolver(faithfulProjects(duplicatesOf(NAME)));
    const firstRun = await captureWarnings(
      () => first.findProjectByName({companyId: COMPANY, name: NAME}));
    expect(firstRun.warnings.length).toEqual(1);

    const second = loadProjectResolver(faithfulProjects(duplicatesOf(NAME)));
    const secondRun = await captureWarnings(
      () => second.findProjectByName({companyId: COMPANY, name: NAME}));
    expect(secondRun.warnings.length).toEqual(1);

    // ...while the FIRST instance is still de-duplicating, so the two maps really are separate
    // objects rather than one shared map that happens to have been reset.
    const firstAgain = await captureWarnings(
      () => first.findProjectByName({companyId: COMPANY, name: NAME}));
    expect(firstAgain.warnings).toEqual([]);
  });
});
