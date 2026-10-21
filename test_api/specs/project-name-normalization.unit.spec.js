/* eslint-disable no-undef */
// Project names are stored trimmed, and resolved trimmed (follow-up to the idempotent project create).
//
// An earlier change made `POST /api/v2/core/projects` idempotent on `{companyId, name}` and gave name
// resolution a deterministic winner. It left the NAME ITSELF unnormalised on two of the
// three write paths, so `"  Storefront  "` and `"Storefront"` are two different projects and
// an ingest call naming either one only ever finds its own spelling. The REST create arm was
// the exception - `cleanAndValidateProject` runs SimpleSchema's `clean`, which trims - which
// is exactly what made the inconsistency invisible from the API side.
//
// Two halves, asserted separately here:
//   1. `normalizeProjectName()` - ONE definition of a normalised name. TRIM ONLY. Case
//      folding, interior-whitespace collapsing or Unicode normalisation would change the
//      identity of names ALREADY STORED, and so would silently re-point live ingest at a
//      different project. Those negatives are asserted, not just described.
//   2. the READ side, inside `projectResolver.js`, so every caller of the shared resolver
//      (check.js both arms, moduleResolver.js for SARIF/BOM, scans.js, and handlePost)
//      is covered by one edit. A caller's untrimmed input has to find the stored trimmed
//      name - that is the reported bug, and it is independent of whether legacy rows are
//      clean.
//
// The `_id` arm of `findProjectByNameOrId` is deliberately NOT normalised: trimming an id
// operand WIDENS the lookup, so `"  abc  "` would start matching the project `abc`. That
// direction is asserted too, because it is the one a well-meaning "trim everything" edit
// gets wrong.
const {loadMeteorModule} = require('../helpers/loadMeteorModule');

const {normalizeProjectName} = loadMeteorModule('imports/lib/project/projectName.js', {});

// --- the same shape of in-memory Mongo the other project-resolution specs use -------------
// Deliberately loose: it ignores `{sort}` and `{limit}`, which is what keeps the resolver's
// JS comparator honest (see project-resolution.unit.spec.js). Nothing here depends on order.
function matches(doc, selector) {
  return Object.keys(selector).every(function (key) { return doc[key] === selector[key]; });
}

function fakeProjects(docs) {
  const state = {docs: docs || [], queries: []};
  return {
    state: state,
    find: function (selector, options) {
      state.queries.push({selector: selector, options: options});
      const found = state.docs.filter(function (doc) { return matches(doc, selector); });
      return {fetchAsync: async function () { return found; }};
    },
    findOneAsync: async function (selector) {
      state.queries.push({selector: selector, options: null});
      return state.docs.filter(function (doc) { return matches(doc, selector); })[0] || null;
    }
  };
}

function loadProjectResolver(projects) {
  return loadMeteorModule('imports/server/rest-api/projectResolver.js', {
    '/imports/lib/collections/projects': {default: projects},
    '/imports/lib/security/sanitizeQuery': {asString: function (v) {
      return typeof v === 'string' ? v : undefined;
    }},
    '/imports/lib/project/projectName': {normalizeProjectName: normalizeProjectName}
  });
}

const COMPANY = 'company-1';
const NAME = 'Storefront';
const STORED = {_id: 'p-a', companyId: COMPANY, name: NAME, creationDate: new Date('2024-01-01T00:00:00Z')};

describe('normalizeProjectName trims, and does nothing else', () => {
  it.each([
    ['leading spaces', '   Storefront', 'Storefront'],
    ['trailing spaces', 'Storefront   ', 'Storefront'],
    ['both ends', '  Storefront  ', 'Storefront'],
    ['a tab', '\tStorefront\t', 'Storefront'],
    ['a newline', '\nStorefront\n', 'Storefront'],
    ['a carriage return', '\rStorefront\r', 'Storefront'],
    ['a non-breaking space', '\u00A0Storefront\u00A0', 'Storefront'],
    ['nothing to trim', 'Storefront', 'Storefront'],
    ['an empty string', '', ''],
    ['whitespace only', '   \t\n  ', '']
  ])('trims %s', (_label, input, expected) => {
    expect(normalizeProjectName(input)).toEqual(expected);
  });

  it('is idempotent - normalising an already-normalised name is a no-op', () => {
    const once = normalizeProjectName('  Storefront  ');
    expect(normalizeProjectName(once)).toEqual(once);
  });

  // The three transformations that would re-point live ingest at a DIFFERENT stored project.
  // Each of these is a plausible "normalise the name" edit, and each is wrong here.
  it('does NOT case-fold', () => {
    expect(normalizeProjectName('  StoreFront  ')).toEqual('StoreFront');
    expect(normalizeProjectName('STOREFRONT')).toEqual('STOREFRONT');
  });

  it('does NOT collapse interior whitespace', () => {
    expect(normalizeProjectName('  My   Store  Front  ')).toEqual('My   Store  Front');
    expect(normalizeProjectName('My\tStore')).toEqual('My\tStore');
  });

  it('does NOT Unicode-normalise', () => {
    // NFC would fold the combining acute onto the A and make this 5 code units, not 6.
    const decomposed = 'A\u0301pple';
    expect(normalizeProjectName('  ' + decomposed + '  ')).toEqual(decomposed);
    expect(normalizeProjectName(decomposed).length).toEqual(decomposed.length);
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a number', 42],
    ['a boolean', true],
    ['an array', ['Storefront']],
    ['an object', {name: 'Storefront'}],
    ['an operator expression', {$gt: ''}],
    ['a Date', new Date()]
  ])('answers undefined for %s', (_label, value) => {
    expect(normalizeProjectName(value)).toBeUndefined();
  });
});

describe('findProjectByName normalises the name it is asked for', () => {
  it('an untrimmed caller name finds the stored trimmed project', async () => {
    const projects = fakeProjects([STORED]);
    const {findProjectByName} = loadProjectResolver(projects);

    const project = await findProjectByName({companyId: COMPANY, name: '  ' + NAME + '  '});

    expect(project).not.toBeNull();
    expect(project._id).toEqual('p-a');
  });

  it('the trimmed name is what reaches the selector - the tenant is still ANDed in', async () => {
    const projects = fakeProjects([STORED]);
    const {findProjectByName} = loadProjectResolver(projects);

    await findProjectByName({companyId: COMPANY, name: '\n ' + NAME + ' \t'});

    expect(projects.state.queries.length).toEqual(1);
    expect(projects.state.queries[0].selector).toEqual({name: NAME, companyId: COMPANY});
  });

  it.each([
    ['an empty string', ''],
    ['spaces only', '     '],
    ['a tab and a newline', '\t\n']
  ])('answers null WITHOUT querying for %s', async (_label, name) => {
    const projects = fakeProjects([STORED]);
    const {findProjectByName} = loadProjectResolver(projects);

    const project = await findProjectByName({companyId: COMPANY, name: name});

    expect(project).toBeNull();
    // The point of the assertion: an empty-after-trim name must not become a query at all.
    // A `{name: ''}` read is a wasted round trip that can only ever answer nothing.
    expect(projects.state.queries.length).toEqual(0);
  });

  it('still answers null without querying for a non-string name', async () => {
    const projects = fakeProjects([STORED]);
    const {findProjectByName} = loadProjectResolver(projects);

    expect(await findProjectByName({companyId: COMPANY, name: {$gt: ''}})).toBeNull();
    expect(await findProjectByName({companyId: COMPANY, name: 42})).toBeNull();
    expect(projects.state.queries.length).toEqual(0);
  });

  it('does not match a stored name that is itself untrimmed', async () => {
    // A legacy row written before the write paths were closed. The read side trims the
    // CALLER's input; it does not fuzzy-match the database. Making it do so would be a
    // second, silent identity change on rows nobody has audited.
    const projects = fakeProjects([{_id: 'p-legacy', companyId: COMPANY, name: '  ' + NAME + '  '}]);
    const {findProjectByName} = loadProjectResolver(projects);

    expect(await findProjectByName({companyId: COMPANY, name: NAME})).toBeNull();
  });
});

describe('findProjectByNameOrId trims the NAME arm and never the _id arm', () => {
  it('matches an _id on the RAW value', async () => {
    const projects = fakeProjects([STORED]);
    const {findProjectByNameOrId} = loadProjectResolver(projects);

    const project = await findProjectByNameOrId({companyId: COMPANY, nameOrId: 'p-a'});

    expect(project._id).toEqual('p-a');
    expect(projects.state.queries[0].selector).toEqual({_id: 'p-a', companyId: COMPANY});
  });

  it('an untrimmed id does NOT match that project - trimming would WIDEN the id lookup', async () => {
    const projects = fakeProjects([STORED]);
    const {findProjectByNameOrId} = loadProjectResolver(projects);

    // `"  p-a  "` is not the id `p-a`, and no project is named `p-a` either, so both arms
    // legitimately miss. If the id operand were trimmed this would answer the project.
    expect(await findProjectByNameOrId({companyId: COMPANY, nameOrId: '  p-a  '})).toBeNull();
    expect(projects.state.queries[0].selector).toEqual({_id: '  p-a  ', companyId: COMPANY});
  });

  it('the fallback NAME arm does normalise', async () => {
    const projects = fakeProjects([STORED]);
    const {findProjectByNameOrId} = loadProjectResolver(projects);

    const project = await findProjectByNameOrId({companyId: COMPANY, nameOrId: '  ' + NAME + '  '});

    expect(project._id).toEqual('p-a');
    // Two reads: the authoritative id arm on the raw value, then the name arm on the
    // trimmed one. The id arm keeping the raw value is what the middle assertion pins.
    expect(projects.state.queries.length).toEqual(2);
    expect(projects.state.queries[0].selector._id).toEqual('  ' + NAME + '  ');
    expect(projects.state.queries[1].selector).toEqual({name: NAME, companyId: COMPANY});
  });

  it('a whitespace-only reference answers null after the id arm alone', async () => {
    const projects = fakeProjects([STORED]);
    const {findProjectByNameOrId} = loadProjectResolver(projects);

    expect(await findProjectByNameOrId({companyId: COMPANY, nameOrId: '   '})).toBeNull();
    // The id arm still runs on the raw value - an id CAN in principle be any string, and
    // this function's contract is that an id match is authoritative - but the name arm,
    // whose operand is empty after trimming, must not issue a second, pointless read.
    expect(projects.state.queries.length).toEqual(1);
    expect(projects.state.queries[0].selector._id).toEqual('   ');
  });
});
