/* eslint-disable no-undef */
// Three related client-side load-state fixes:
//
//   * the module Components / Dependencies lists spun forever instead of showing an empty
//     state, because `listStatus` could not tell "loaded, nothing to show" (0 rows) apart
//     from "still loading" (0 rows on the current page slice of a large scan);
//   * `getModuleComponents` rejections were unhandled, so a failure looked identical to a
//     slow load;
//   * `reactiveTableServerSide` fetched during the DDP login handshake and rendered the
//     server's "401 Authentication required" as a hard error on every cold page load.
//
// Blaze rendering is out of reach for this harness (see the report's Coverage Gaps), but the
// producer/consumer pair that decides spinner-vs-empty-state is ordinary expression logic. It
// is EXTRACTED FROM THE REAL SOURCE and evaluated here rather than retyped, so a change to
// either half is caught: a sentinel changed back to 0, or a consumer that stops treating 0 as
// "loading", breaks the round trip.
const {readSourceWithoutComments} = require('../helpers/loadMeteorModule');

const LIST_VIEWS = {
  'module-dependencies (Dependencies tab)':
    'imports/client/ui/module/module-details/module-dependencies/module-dependencies.js',
  'module-detail-components (Components tab)':
    'imports/client/ui/module/module-details/module-detail-components.js'
};

// Unchanged by this work, but it carries the same sentinel and is asserted for consistency.
const LICENSES_VIEW = 'imports/client/ui/module/module-details/module-detail-licenses.js';

const sources = Object.keys(LIST_VIEWS).reduce((acc, label) => {
  acc[label] = readSourceWithoutComments(LIST_VIEWS[label]);
  return acc;
}, {});

// `Session.set('listStatus', <expr>)` - the two-argument call only; the bare reset call
// `Session.set('listStatus');` must not match. The name of the page-slice variable differs
// per view, so it is read out of the same source rather than assumed.
function extractProducer(src, label) {
  const match = src.match(/Session\.set\(\s*'listStatus'\s*,\s*([^\n;]+?)\s*\)\s*;/);
  if (!match) throw new Error(`No listStatus producer found in ${label} - the spec must follow the change.`);
  const sliceVar = src.match(/(?:let|const)\s+(\w+)\s*=\s*result\.slice\(/);
  if (!sliceVar) throw new Error(`No page-slice variable found in ${label} - the spec must follow the change.`);
  // eslint-disable-next-line no-new-func
  return new Function('result', sliceVar[1], `return (${match[1]});`);
}

function extractConsumer(src, label) {
  const match = src.match(/requestInProgress:\s*function\s*\(\)\s*\{[\s\S]*?return\s*([^\n;]+?)\s*;/);
  if (!match) throw new Error(`No requestInProgress consumer found in ${label} - the spec must follow the change.`);
  // eslint-disable-next-line no-new-func
  return new Function('status', `return (${match[1]});`);
}

describe.each(Object.keys(LIST_VIEWS))('%s - spinner vs empty state', (label) => {
  const src = sources[label];
  const produce = extractProducer(src, label);
  const consume = extractConsumer(src, label);

  // The real helpers compute `currentComponents = result.slice(size*(page-1), size*page)`.
  function statusFor(total, page, size) {
    const result = new Array(total).fill({});
    return produce(result, result.slice(size * (page - 1), size * page));
  }

  it('a module with NO components resolves to the empty state, not the spinner', () => {
    const status = statusFor(0, 1, 10);
    expect(status).not.toBe(0);          // the exact value that means "still loading"
    expect(consume(status)).toBe(false); // -> empty state renders
  });

  it('a populated first page resolves to the empty state check being off', () => {
    expect(consume(statusFor(40, 1, 10))).toBe(false);
  });

  it('a populated last partial page still counts as loaded', () => {
    expect(consume(statusFor(35, 4, 10))).toBe(false);
  });

  // Opposite direction: the transient case the sentinel exists to protect must STILL show the
  // spinner. Asserting only the empty-state half would not catch a change that made every
  // mid-load slice flash "no data".
  it('an out-of-range page slice of a loaded list keeps the spinner up', () => {
    const status = statusFor(40, 9, 10);
    expect(status).toBe(0);
    expect(consume(status)).toBe(true);
  });

  it('nothing loaded yet keeps the spinner up', () => {
    expect(consume(undefined)).toBe(true);
  });

  it('the sentinel is a truthy non-zero value (so the consumer cannot mistake it for 0)', () => {
    const sentinel = statusFor(0, 1, 10);
    expect(sentinel).toBeTruthy();
    expect(typeof sentinel).not.toBe('number');
  });
});

describe('the Licenses tab (unchanged) uses the same sentinel', () => {
  it('so all three module detail lists agree on what "loaded but empty" looks like', () => {
    const src = readSourceWithoutComments(LICENSES_VIEW);
    expect(src).toMatch(/Session\.set\('listStatus',[^;]*'empty'\)/);
    expect(src).toMatch(/requestInProgress:\s*function[\s\S]{0,200}status === 0 \|\| !status/);
  });

  it.each(Object.keys(LIST_VIEWS))('%s emits the same string sentinel', (label) => {
    expect(sources[label]).toMatch(/Session\.set\('listStatus',[^;]*'empty'\)/);
  });
});

describe('getModuleComponents failures are reported, not swallowed', () => {
  const CHANGED = [
    'imports/client/ui/module/module-details/module-dependencies/module-dependencies.js',
    'imports/client/ui/module/module-details/module-detail-components.js'
  ];

  it.each(CHANGED)('%s attaches a .catch to the getModuleComponents call', (file) => {
    const src = readSourceWithoutComments(file);
    const at = src.indexOf("'getModuleComponents'");
    expect(at).toBeGreaterThan(-1);
    // The catch must belong to this call's promise chain, not sit somewhere else in the file.
    const chain = src.slice(at, at + 1400);
    expect(chain).toMatch(/\}\)\.catch\(function \(error\)/);
  });

  it.each(CHANGED)('%s clears the spinner and tells the user when the call fails', (file) => {
    const src = readSourceWithoutComments(file);
    const handler = src.slice(src.indexOf("'getModuleComponents'"));
    expect(handler).toMatch(/Session\.set\('moduleComponents',\s*\[\]\)/);
    expect(handler).toMatch(/Notify\.danger\(/);
  });

  it.each(CHANGED)('%s imports Notify, so the danger toast resolves at runtime', (file) => {
    expect(readSourceWithoutComments(file)).toMatch(/import Notify from '\/imports\/api\/notify'/);
  });
});

describe('a nullish RESOLVE is normalised the same way a rejection is', () => {
  // `getModuleComponents` (imports/server/collections/modules.js) returns `undefined` when the
  // module does not resolve for the caller's company - a stale deep link, or a cold load where
  // the tenant is not yet known. That is a RESOLVE, so the .catch above never runs.
  //
  // Both list helpers guard on `if (module && module._id && <components>)`, so an `undefined`
  // payload skips the body entirely, `listStatus` is never set, and requestInProgress stays
  // true - the exact "spinner forever" symptom this change set out to remove.
  it.each([
    ['module-dependencies', 'imports/client/ui/module/module-details/module-dependencies/module-dependencies.js'],
    ['module-detail-components', 'imports/client/ui/module/module-details/module-detail-components.js']
  ])('%s stores [] rather than a nullish payload', (_label, file) => {
    const src = readSourceWithoutComments(file);
    const thenBlock = src.slice(src.indexOf("'getModuleComponents'"));
    const assignment = thenBlock.match(/Session\.set\('moduleComponents',\s*([^)]*)\)/);
    expect(assignment).not.toBeNull();
    expect(assignment[1].trim()).toBe('data || []');
  });

  it('the helper guard is what makes the normalisation necessary', () => {
    // Documents the coupling: if the guard is ever loosened, the assertion above can relax too.
    expect(sources['module-dependencies (Dependencies tab)'])
      .toMatch(/if \(module && module\._id && components\)/);
    expect(sources['module-detail-components (Components tab)'])
      .toMatch(/if \(module && module\._id && moduleComponents\)/);
  });
});

describe('reactiveTableServerSide defers the fetch until the session resolves', () => {
  const src = readSourceWithoutComments(
    'imports/client/ui/common/reactive-table-server-side/reactive-table-server-side.js'
  );

  it('guards on BOTH loggingIn and userId (either alone leaves a cold-load window open)', () => {
    expect(src).toMatch(/if \(Meteor\.loggingIn\(\) \|\| !Meteor\.userId\(\)\)/);
  });

  // The autorun that reruns on every reactive dependency - this is the block the guard must
  // live in, so that resolving the session retries the fetch instead of leaving it abandoned.
  const autorunAt = src.indexOf('this.autorun(');
  const autorunBlock = src.slice(autorunAt);

  it('the guard sits inside the reactive autorun, not in a one-shot setup path', () => {
    // A one-shot check in onCreated would never retry - the table would stay empty for good.
    expect(autorunAt).toBeGreaterThan(-1);
    expect(autorunBlock.indexOf('Meteor.loggingIn()')).toBeGreaterThan(-1);
  });

  it('the guard runs BEFORE the request signature is computed and the fetch is triggered', () => {
    const guardAt = autorunBlock.indexOf('Meteor.loggingIn()');
    const sigAt = autorunBlock.indexOf('const sig = JSON.stringify(');
    expect(sigAt).toBeGreaterThan(guardAt);
    // getTableData() is what issues the Meteor method call this guard exists to hold back.
    const fetchAt = autorunBlock.indexOf('getTableData(');
    expect(fetchAt).toBeGreaterThan(-1);
    expect(fetchAt).toBeGreaterThan(guardAt);
  });

  it('shows the loading state rather than an error while it waits', () => {
    const guardAt = src.indexOf('Meteor.loggingIn()');
    const block = src.slice(guardAt, guardAt + 200);
    expect(block).toMatch(/template\.loading\.set\(true\)/);
    expect(block).toMatch(/return;/);
    expect(block).not.toMatch(/error/i);
  });
});

describe('module list refreshes when a module appears asynchronously', () => {
  const src = readSourceWithoutComments('imports/client/ui/module/module-list/module-list.js');

  it('subscribes to modulesByProject purely as a change signal', () => {
    expect(src).toMatch(/this\.subscribe\('modulesByProject'/);
    expect(src).toMatch(/import Modules from '\/imports\/lib\/collections\/modules'/);
  });

  it('waits for the subscription before reading the collection', () => {
    expect(src).toMatch(/if \(!template\.subscriptionsReady\(\)\) return;/);
  });

  it('handles the Unassigned bucket, which has no projectId at all', () => {
    expect(src).toMatch(/projectId === Projects\.UNASSIGNED/);
    expect(src).toMatch(/\{projectId: \{\$exists: false\}\}/);
  });

  it('refetches only when the signature actually changed (no refetch loop)', () => {
    expect(src).toMatch(/if \(template\.knownModulesSignature === signature\) return;/);
    const sigAt = src.indexOf('const signature =');
    const callAt = src.indexOf("Meteor.callAsync('modulesByProject'");
    expect(sigAt).toBeGreaterThan(-1);
    expect(callAt).toBeGreaterThan(sigAt);
  });

  it('includes `analyzed` in the signature so statistics refresh after an analysis', () => {
    expect(src).toMatch(/module\.analyzed \? new Date\(module\.analyzed\)\.getTime\(\)/);
  });

  it('handles a rejected refetch instead of leaving an unhandled rejection', () => {
    const chain = src.slice(src.indexOf("Meteor.callAsync('modulesByProject'"));
    expect(chain.slice(0, 400)).toMatch(/\.catch\(function \(error\)/);
  });
});
