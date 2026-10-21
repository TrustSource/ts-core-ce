// Owns the client's per-user caches.
//
// One reactive sync for the whole app, rather than a copy per layout: the layouts
// used to run this themselves behind a module-level boolean, which survived a
// sign-out and left the next user looking at the previous user's company and
// module list. See ./perUserBootstrap.js for the decision logic and why it lives
// in its own Meteor-free module.
import {Meteor} from 'meteor/meteor';
import {Tracker} from 'meteor/tracker';
import {Session} from 'meteor/session';
import {ReactiveMethod} from '/imports/lib/reactiveMethod';

const {createPerUserBootstrap} = require('./perUserBootstrap');

// Session keys holding data that belongs to exactly one signed-in user. Anything
// added here is dropped automatically the moment the user changes.
// `company` and `modulesByProject` are the two the app bootstraps and reads
// everywhere; `companyProjects` and `getUsers` are refilled by whichever page
// needs them, but are read by pages that never set them, so a stale one shows
// the previous tenant's projects/users until that page's own fetch lands.
const PER_USER_SESSION_KEYS = ['company', 'modulesByProject', 'companyProjects', 'getUsers'];

const syncPerUserCaches = createPerUserBootstrap({
  clearCaches: function () {
    PER_USER_SESSION_KEYS.forEach(function (key) {
      Session.set(key, undefined);
    });
    // ReactiveMethod memoises on [methodName, ...args], so a call with no
    // per-user argument - `countCompanyProject`, `getUserCompanies` - keeps the
    // previous user's answer for the whole page load. That is what made the
    // projects list warn "6 of 242 visible to you" at a user who could see all
    // six of his. clearCache() was written for this ("e.g. on logout") and had
    // no caller until now.
    ReactiveMethod.clearCache();
  },
  fetchCaches: function (userId, onFailure) {
    Meteor.callAsync('getCompanyCurrent').then(function (data) {
      if (!data) { return onFailure(); }
      Session.set('company', data);
    }).catch(onFailure);

    Meteor.callAsync('modulesByProject', false, true).then(function (data) {
      if (data === undefined) { return onFailure(); }
      Session.set('modulesByProject', data);
    }).catch(onFailure);
  }
});

// Keyed on `Meteor.user()`, not `Meteor.userId()`: on a page refresh the client
// returns a userId optimistically from the resume token before the server has
// acknowledged the login, so the methods would run with this.userId=null on the
// server. Waiting for the user document means waiting for that handshake.
Tracker.autorun(function () {
  const user = Meteor.user();
  syncPerUserCaches(user && user._id);
});

export {syncPerUserCaches, PER_USER_SESSION_KEYS};
