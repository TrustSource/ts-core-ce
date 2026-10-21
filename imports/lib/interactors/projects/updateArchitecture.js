import {Meteor} from 'meteor/meteor';
import {Roles} from 'meteor/alanning:roles';
import Projects from '/imports/lib/collections/projects';
import {PROJECT_DESCRIPTION_MAX} from '/imports/lib/schemas/projectSchema';

// Projects.UpdateArchitecture - save an uploaded architecture.md's
// content (or directly-typed text) into a project's "Application goals" /
// `description` field. The RBAC role list mirrors every sibling
// project-general interactor (updateEndoflifePolicy.js, updateCiaRequirements.js,
// updateObligationConfig.js, updateRequirements.js, updateRelease.js) rather than the client-only entity-conditional
// hasAccessRight logic, which has no server-side equivalent.
//
// Check order is fail-fast, cheapest first: auth/role -> type checks -> size
// cap -> company-scoped project load -> persist. The REST POST handler
// (imports/server/rest-api/projects.js) applies the same checks.
const updateArchitecture = async function (projectId, content) {
  const user = await Meteor.userAsync();
  const companyId = user && user.profile && user.profile.companyId;
  if (!companyId || !await Roles.userIsInRole(user, ['account_admin', 'manager', 'compliance_manager'], companyId)) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  if (typeof projectId !== 'string') {
    throw new Meteor.Error(400, 'Invalid id');
  }
  if (typeof content !== 'string') {
    throw new Meteor.Error(400, 'Invalid content');
  }
  if (content.length > PROJECT_DESCRIPTION_MAX) {
    throw new Meteor.Error(400, 'Content too large');
  }
  const project = await Projects.findOneAsync(projectId, {fields: {companyId: 1}});
  if (!project || project.companyId !== companyId) {
    throw new Meteor.Error(403, 'Access Denied');
  }

  const cnt = await Projects.updateAsync(projectId, {$set: {description: content}});
  if (cnt !== 1) {
    throw new Meteor.Error(500, 'Could not update db');
  }
  return cnt;
};

export default updateArchitecture;
