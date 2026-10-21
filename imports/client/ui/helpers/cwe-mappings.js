import {Meteor} from 'meteor/meteor';
import {Roles} from 'meteor/alanning:roles';
import CweMappings from '/imports/lib/collections/cweMappings';
import {indexMappings} from '/imports/lib/sarif/cweMappingOverlay';
import {CWE_MAPPING_WRITE_ROLES} from '/imports/lib/interactors/cweMappings/roles';

// Client-side access to the manual CWE assignments, shared by the
// three places a weakness badge is drawn: the test document, the tests list and
// a module's tests tab.
//
// Reads the minimongo cursor rather than caching, so every consumer is reactive:
// assigning a CWE repaints the badges without a reload, which is the whole point
// of overlaying rather than storing.

export function currentCompanyId() {
  const user = Meteor.user();
  return (user && user.profile && user.profile.companyId) || null;
}

export function cweMappingIndex() {
  return indexMappings(CweMappings.find().fetch(), currentCompanyId());
}

// Assigning a weakness is a claim this company can later nominate as every
// company's default, so it is held to the two roles that answer for it - see
// set.js, which enforces the same list server-side.
export function canAssignCwe() {
  const user = Meteor.user();
  return !!user && Roles.userIsInRole(user, CWE_MAPPING_WRITE_ROLES, user.profile.companyId);
}
