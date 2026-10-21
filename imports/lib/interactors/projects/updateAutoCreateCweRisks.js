import {Meteor} from 'meteor/meteor';
import {Roles} from 'meteor/alanning:roles';
import Projects from '/imports/lib/collections/projects';

// The "create risks from SARIF weaknesses (CWE)" project toggle.
//
// A dedicated method rather than a field on the general-settings autoForm.
// `isModificationAllowed()` (imports/server/collections/projects.js) is a
// per-field allow-list with no branch for a single-field update, and the form
// survives today only because of the one unbounded `relatedUsers` branch - which
// stops matching whenever those Session-backed user lists are empty and none of
// the relatedUsers fields render. Hanging this toggle off that path would
// inherit a save that reports success and silently does nothing (AC2).
//
// Same shape as the shipped updateEndoflifePolicy / updateRequireWhitelist
// toggles, including their role list.
const updateAutoCreateCweRisks = async function (projectId, enabled) {
  // A bare `projectId` reaches Mongo as a full selector when it is an object, so
  // the type is checked BEFORE either query is built - an untyped id is this
  // repo's standing way of turning a scoped read into an unscoped one.
  if (typeof projectId !== 'string' || !projectId) {
    throw new Meteor.Error(400, 'Invalid arguments');
  }
  const user = await Meteor.userAsync();
  const companyId = user && user.profile && user.profile.companyId;
  if (!companyId || !await Roles.userIsInRole(user,
    ['account_admin', 'manager', 'compliance_manager'], companyId)) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  // BOTH selectors carry companyId. Reading the ownership off the document that
  // came back is not enough on its own: updateAsync re-runs its own selector
  // independently of the read, so an unscoped one would be a write with no
  // tenant boundary of its own.
  const project = await Projects.findOneAsync({_id: projectId, companyId},
    {fields: {companyId: 1}});
  if (!project || project.companyId !== companyId) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  // Coerced, never stored as whatever the client sent: this value is read back
  // with a strict `=== true` on every import, so anything truthy-but-not-true
  // would silently mean "off" and look like a lost setting.
  const cnt = await Projects.updateAsync({_id: projectId, companyId},
    {$set: {autoCreateCweRisks: enabled === true}});
  if (cnt !== 1) {
    throw new Meteor.Error(500, 'Could not update db');
  }
};

export default updateAutoCreateCweRisks;
