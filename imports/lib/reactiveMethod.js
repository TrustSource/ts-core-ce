/**
 * Drop-in replacement for the `simple:reactive-method` Meteor package.
 *
 * ReactiveMethod.call(methodName, ...args) reactively calls a Meteor method.
 * Returns undefined initially, then re-triggers the reactive computation
 * when the result arrives.
 *
 * Usage (same as original):
 *   import {ReactiveMethod} from '/imports/lib/reactiveMethod';
 *   // inside a Blaze helper:
 *   return ReactiveMethod.call('myMethod', arg1, arg2);
 */
import {Meteor} from 'meteor/meteor';
import {ReactiveVar} from 'meteor/reactive-var';

const cache = new Map();

// How many calls of each method are in flight, reactively. A helper rendering a
// list of rows fires one call per row, so a view that wants to say "still
// loading" has to watch the whole set rather than any single call.
const pendingCounts = new Map();

function pendingVar(methodName) {
  if (!pendingCounts.has(methodName)) {
    pendingCounts.set(methodName, new ReactiveVar(0));
  }
  return pendingCounts.get(methodName);
}

function addPending(methodName, delta) {
  const rv = pendingVar(methodName);
  rv.set(Math.max(0, rv.curValue + delta));
}

const ReactiveMethod = {
  call(methodName, ...args) {
    // Opened as the first page, a template asks before the login has resumed: the
    // call fails, and nothing ran the helper again once the user was logged in.
    // Reading the login state here makes the helper re-run when it changes, and
    // the user id in the key makes that re-run call again.
    if (Meteor.isClient && Meteor.loggingIn()) {
      return undefined;
    }
    const key = JSON.stringify([Meteor.isClient ? Meteor.userId() : null, methodName, ...args]);

    if (!cache.has(key)) {
      const rv = new ReactiveVar(undefined);
      cache.set(key, rv);
      addPending(methodName, 1);

      Meteor.call(methodName, ...args, (error, result) => {
        addPending(methodName, -1);
        if (error) {
          console.error(`ReactiveMethod error calling ${methodName}:`, error);
          // Drop the entry so a later reactive re-run retries instead of
          // returning a permanently-failed result.
          cache.delete(key);
          rv.set(undefined);
        } else {
          rv.set(result);
        }
      });
    }

    return cache.get(key).get();
  },

  // Reactive count of in-flight calls of one method. Reading this inside a
  // computation that also calls that method would loop - read it from a
  // separate helper.
  pending(methodName) {
    return pendingVar(methodName).get();
  },

  // Allow clearing cache if needed (e.g. on logout)
  clearCache() {
    cache.clear();
  }
};

export {ReactiveMethod};
