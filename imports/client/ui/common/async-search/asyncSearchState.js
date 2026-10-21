import {Meteor} from 'meteor/meteor';
import {ReactiveVar} from 'meteor/reactive-var';
import {PHASE_THRESHOLDS_MS, SEARCH_TIMEOUT_MS} from './searchPhases';

// Reactive state for one search request. Deliberately generic
// rather than lake-specific so other slow-request pages can adopt it.
//
// Two properties matter beyond the obvious:
//
// 1. Stale-response guard. Every run() bumps a token captured in the closure. A
//    settled promise whose token is no longer current is discarded, so a slow
//    first request cannot overwrite the results of a fast second one.
//
// 2. Timer cleanup. Phase timers and the timeout are cleared the moment the
//    request settles and again on stop(), which every consumer calls from
//    onDestroyed. Otherwise a timer fires against a torn-down template.
export function createSearchState() {
  const status = new ReactiveVar('idle');
  const rows = new ReactiveVar([]);
  const error = new ReactiveVar(null);
  const phase = new ReactiveVar(0);

  let token = 0;
  let timers = [];
  let lastRun = null;

  function clearTimers() {
    for (const timer of timers) {
      Meteor.clearTimeout(timer);
    }
    timers = [];
  }

  function scheduleTimers() {
    clearTimers();
    PHASE_THRESHOLDS_MS.forEach(function (ms, index) {
      timers.push(Meteor.setTimeout(function () {
        phase.set(index + 1);
      }, ms));
    });
    timers.push(Meteor.setTimeout(function () {
      // Abandon the in-flight request: bumping the token makes its eventual
      // resolution a no-op.
      token += 1;
      clearTimers();
      error.set({message: null, timeout: true});
      status.set('error');
    }, SEARCH_TIMEOUT_MS));
  }

  function run(fn) {
    lastRun = fn;
    token += 1;
    const current = token;

    rows.set([]);
    error.set(null);
    phase.set(0);
    status.set('loading');
    scheduleTimers();

    // Promise.resolve().then(fn) so a synchronous throw inside fn becomes a
    // rejection rather than escaping run().
    Promise.resolve()
      .then(fn)
      .then(function (result) {
        if (current !== token) {
          return;
        }
        clearTimers();
        rows.set(result || []);
        status.set('ready');
      })
      .catch(function (err) {
        if (current !== token) {
          return;
        }
        clearTimers();
        // Only the server-supplied `reason` is trusted here, never `message`.
        // Meteor.Error synthesizes `message` from the error CODE when no reason
        // is given, which for an HTTP failure is the response object stringified -
        // so err.message can read literally as "[object Object]", and a bare error
        // code can leak an internal detail (e.g. a missing env var name) straight
        // to the user.
        error.set({
          message: (err && typeof err.reason === 'string' && err.reason) || null,
          timeout: false
        });
        status.set('error');
      });
  }

  return {
    status: function () { return status.get(); },
    rows: function () { return rows.get(); },
    error: function () { return error.get(); },
    phase: function () { return phase.get(); },
    run: run,
    retry: function () {
      if (lastRun) {
        run(lastRun);
      }
    },
    reset: function () {
      clearTimers();
      token += 1;
      lastRun = null;
      status.set('idle');
      rows.set([]);
      error.set(null);
      phase.set(0);
    },
    stop: function () {
      clearTimers();
      token += 1;
    }
  };
}
