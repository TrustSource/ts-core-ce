// Decides when the client's per-user caches must be dropped and refilled.
//
// The client keeps two blobs that belong to ONE signed-in user (`Session.company`
// and `Session.modulesByProject`). Nothing reloads the page between
// `Meteor.logout()` and the next `Router.go('dashboard')` - both are client-side
// route changes - so `Session` and every module scope outlive a sign-out. A guard
// that only remembers "have we fetched yet" therefore keeps the previous user's
// data on screen for the next one. The guard has to be keyed on WHOSE data is
// cached, which is what this factory does.
//
// Pure and Meteor-free (CommonJS, no 'meteor/*' imports) so the jest harness can
// require it without a Blaze/Meteor runtime - same approach as
// imports/client/ui/vulnerability-lake/vulnerabilityLakeCweHelpers.js. The Meteor
// wiring lives in ./user-session.js.

// deps.clearCaches()                    - drop whatever is cached now
// deps.fetchCaches(userId, onFailure)   - refill for this user; call onFailure if
//                                         a call rejects, to allow a later retry
function createPerUserBootstrap(deps) {
  const clearCaches = deps.clearCaches;
  const fetchCaches = deps.fetchCaches;

  // Whose data the caches hold, or are being filled with. null = nothing cached.
  let ownerUserId = null;

  function sync(userId) {
    const id = userId || null;
    if (id === ownerUserId) {
      return;
    }
    // The signed-in user changed (sign-in, sign-out or a straight switch).
    // Whatever is cached belongs to somebody else: drop it BEFORE the refill so
    // no view can render the previous user's company or module list.
    clearCaches();
    ownerUserId = id;
    if (!id) {
      return;
    }
    fetchCaches(id, function onFailure() {
      // Let the next run try again - but only while this is still the current
      // user, so a late rejection from a user who has since signed out cannot
      // invalidate the caches of the one who replaced them.
      if (ownerUserId === id) {
        ownerUserId = null;
      }
    });
  }

  // Whose data is cached right now. Exposed for tests and debugging.
  sync.ownerUserId = function () {
    return ownerUserId;
  };

  return sync;
}

module.exports = {createPerUserBootstrap};
