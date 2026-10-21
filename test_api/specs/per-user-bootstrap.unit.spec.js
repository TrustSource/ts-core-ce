/* eslint-disable no-undef */
// Regression for "app is not properly loaded with user change".
//
// Symptom: sign in as user A, sign out, sign in as user B - user B does not see
// the full details of his projects.
//
// Cause: the client caches two per-user blobs in `Session` (`company` and
// `modulesByProject`) and filled them behind a module-level boolean guard
// (`bootstrapFetched`, introduced in f66a47ff5). Nothing between
// `Meteor.logout()` and the next `Router.go('dashboard')` reloads the page - both
// are client-side route changes - so the module scope, and that boolean, outlive
// the logout. On the second sign-in the guard short-circuits and user B renders
// against user A's cached company and module list: `project-list.js` and
// `module-list.js` compute their lists from the stale `modulesByProject`.
//
// The fix moves the decision into a pure factory that is keyed on the user id
// rather than on "have we ever fetched", so a change of user always drops the
// previous user's caches and refills them. This spec exercises that factory
// directly - it is deliberately Meteor-free (CommonJS, no 'meteor/*' imports) so
// jest can require it without a Blaze/Meteor runtime, the same approach as
// imports/client/ui/vulnerability-lake/vulnerabilityLakeCweHelpers.js.
const fs = require('fs');
const path = require('path');
const {createPerUserBootstrap} = require('../../imports/startup/client/perUserBootstrap');

// Records the side effects the factory asks for, in order.
function recorder() {
  const events = [];
  const failures = [];
  const sync = createPerUserBootstrap({
    clearCaches: function () { events.push('clear'); },
    fetchCaches: function (userId, onFailure) {
      events.push('fetch:' + userId);
      failures.push(onFailure);
    }
  });
  return {sync, events, failures};
}

describe('#142 per-user bootstrap: a change of user drops and refills the caches', () => {
  it('fills the caches on first sign-in', () => {
    const {sync, events} = recorder();
    sync('userA');
    expect(events).toEqual(['clear', 'fetch:userA']);
  });

  it('does not refetch while the same user stays signed in', () => {
    const {sync, events} = recorder();
    sync('userA');
    sync('userA');
    sync('userA');
    expect(events).toEqual(['clear', 'fetch:userA']);
  });

  it('THE BUG: sign in as A, sign out, sign in as B - B must get his own data', () => {
    const {sync, events} = recorder();
    sync('userA');   // A signs in
    sync(null);      // A signs out
    sync('userB');   // B signs in - no page reload happened in between
    expect(events).toEqual(['clear', 'fetch:userA', 'clear', 'clear', 'fetch:userB']);
    // The part that regressed: B's fetch must happen at all.
    expect(events.filter(e => e === 'fetch:userB')).toHaveLength(1);
  });

  it('clears on sign-out even though there is nothing to fetch', () => {
    const {sync, events} = recorder();
    sync('userA');
    events.length = 0;
    sync(null);
    expect(events).toEqual(['clear']);
  });

  it('handles a straight switch from A to B with no sign-out in between', () => {
    const {sync, events} = recorder();
    sync('userA');
    events.length = 0;
    sync('userB');
    expect(events).toEqual(['clear', 'fetch:userB']);
  });

  it('drops the previous user\'s caches BEFORE fetching, so nothing renders A\'s data to B', () => {
    const {sync, events} = recorder();
    sync('userA');
    events.length = 0;
    sync('userB');
    expect(events.indexOf('clear')).toBeLessThan(events.indexOf('fetch:userB'));
  });

  it('retries on the next run when a fetch failed', () => {
    const {sync, events, failures} = recorder();
    sync('userA');
    failures[0]();          // the method call rejected
    events.length = 0;
    sync('userA');          // same user, but nothing is cached - must try again
    expect(events).toEqual(['clear', 'fetch:userA']);
  });

  it('a late failure from the PREVIOUS user cannot force a refetch for the current one', () => {
    const {sync, events, failures} = recorder();
    sync('userA');
    sync('userB');          // B signs in while A's call is still in flight
    events.length = 0;
    failures[0]();          // A's call rejects afterwards
    sync('userB');
    expect(events).toEqual([]);   // B's caches are intact, no refetch
  });

  it('treats undefined and null as signed-out alike', () => {
    const {sync, events} = recorder();
    sync('userA');
    sync(undefined);
    events.length = 0;
    sync(null);
    expect(events).toEqual([]);   // already signed out, nothing more to clear
  });
});

// NON-VACUITY: the same sequence run against the guard this replaced (a bare
// "have we fetched yet" boolean, f66a47ff5) must FAIL, or the tests above would
// pass no matter what the production code does.
describe('#142 NON-VACUITY: the boolean guard this replaced fails the same sequence', () => {
  // A faithful re-implementation of the old layout.js logic.
  function createLegacyBootstrap(deps) {
    let bootstrapFetched = false;
    return function sync(userId) {
      if (!userId || bootstrapFetched) return;
      bootstrapFetched = true;
      deps.fetchCaches(userId, function () { bootstrapFetched = false; });
    };
  }

  it('never fetches for user B, which is exactly the reported bug', () => {
    const events = [];
    const sync = createLegacyBootstrap({
      fetchCaches: function (userId) { events.push('fetch:' + userId); }
    });
    sync('userA');
    sync(null);
    sync('userB');
    expect(events).toEqual(['fetch:userA']);
    expect(events).not.toContain('fetch:userB');
  });

  it('and never drops user A\'s caches, so B renders against them', () => {
    const events = [];
    const sync = createLegacyBootstrap({
      clearCaches: function () { events.push('clear'); },
      fetchCaches: function () {}
    });
    sync('userA');
    sync(null);
    sync('userB');
    expect(events).not.toContain('clear');
  });
});

// The pure factory is only worth anything if the shipped wiring actually uses it
// and the old bare-boolean guard is gone. jest cannot execute the Blaze layouts
// (they import meteor/templating, jQuery, ...), so assert on the shipped source
// text - the same approach as company-api-keys-reveal.frontend.unit.spec.js.
describe('#142 the layouts no longer carry their own once-per-page-load guard', () => {
  const root = path.join(__dirname, '../../imports');

  function sourceOf(relative) {
    return fs.readFileSync(path.join(root, relative), 'utf8')
      .replace(/\/\/[^\n]*/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');
  }

  it('layout.js has no bootstrapFetched guard', () => {
    expect(sourceOf('client/ui/layouts/layout.js')).not.toMatch(/bootstrapFetched/);
  });

  it('substate-layout.js has no bootstrapFetched guard', () => {
    expect(sourceOf('client/ui/layouts/substate-layout.js')).not.toMatch(/bootstrapFetched/);
  });

  it('no layout fetches the per-user caches on its own any more', () => {
    ['client/ui/layouts/layout.js',
      'client/ui/layouts/substate-layout.js',
      'client/ui/layouts/blank-layout.js'].forEach(function (file) {
      expect(sourceOf(file)).not.toMatch(/getCompanyCurrent/);
    });
  });

  it('the wiring installs a single reactive sync keyed on the user id', () => {
    const wiring = sourceOf('startup/client/user-session.js');
    expect(wiring).toMatch(/createPerUserBootstrap/);
    expect(wiring).toMatch(/Tracker\.autorun/);
    expect(wiring).toMatch(/getCompanyCurrent/);
    expect(wiring).toMatch(/modulesByProject/);
  });

  it('the wiring also drops the ReactiveMethod memo on a user change', () => {
    // ReactiveMethod caches on [methodName, ...args]; a zero-arg per-user call
    // such as countCompanyProject / getUserCompanies would otherwise hand the
    // next user the previous user's answer for the whole page load.
    const wiring = sourceOf('startup/client/user-session.js');
    expect(wiring).toMatch(/ReactiveMethod\.clearCache\(\)/);
  });

  it('NON-VACUITY: ReactiveMethod still exposes clearCache and still memoises', () => {
    const rm = sourceOf('lib/reactiveMethod.js');
    expect(rm).toMatch(/clearCache\s*\(\)\s*\{/);
    expect(rm).toMatch(/cache\.set\(key/);
  });

  it('the wiring is loaded from the client startup entry point', () => {
    expect(sourceOf('startup/client/index.js')).toMatch(/user-session/);
  });
});
