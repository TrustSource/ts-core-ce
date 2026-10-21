import {Meteor} from 'meteor/meteor';

// Persistent role subscriptions. These power every `Roles.userIsInRole` check
// in the route guards (see `requireRole` in imports/lib/router.js). They live
// here (not in a route `waitOn`) so they are never stopped/restarted on
// navigation, and so a single readiness signal can be shared by the guards.
//
// This lives in imports/lib (shared code) - NOT under a `client/` directory -
// because router.js is shared and imported on the server too; a file under
// `imports/startup/client/` is excluded from the server bundle and would fail
// to link. The Meteor.isClient guards below keep it server-safe.
let roleAssignmentSub;
let rolesSub;

if (Meteor.isClient) {
  roleAssignmentSub = Meteor.subscribe('roleAssignment');
  rolesSub = Meteor.subscribe('roles');
}

// Reactive: true once role-assignment + role-hierarchy data has arrived.
// On the server there is no subscription concept, so report ready and let the
// server-side role checks run normally.
export function rolesReady() {
  if (!Meteor.isClient) return true;
  return !!(roleAssignmentSub && roleAssignmentSub.ready() &&
    rolesSub && rolesSub.ready());
}
