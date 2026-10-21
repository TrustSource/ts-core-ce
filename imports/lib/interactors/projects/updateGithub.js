import {Meteor} from 'meteor/meteor';
import {Roles} from 'meteor/alanning:roles';
import Projects from '/imports/lib/collections/projects';
import {encrypt} from '/imports/lib/crypto';

const updateGithub = async function (projectId, newSettings) {
  const user = await Meteor.userAsync();
  const companyId = user && user.profile && user.profile.companyId;
  if (!companyId || !await Roles.userIsInRole(user, 'manager', companyId)) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  // Scope by companyId: a manager may only edit a project owned by their company.
  const project = await Projects.findOneAsync({_id: projectId, companyId}, {fields: {'github.token': 1}});
  if (!project) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  // Blank token on save means "keep existing credential" (no longer published).
  if (Object.prototype.hasOwnProperty.call(newSettings, 'token')) {
    if (newSettings.token) {
      newSettings.token = encrypt(newSettings.token);
    } else if (project.github && project.github.token) {
      newSettings.token = project.github.token;
    } else {
      delete newSettings.token;
    }
  }
  const cnt = await Projects.updateAsync({_id: projectId, companyId}, {$set: {'github': newSettings}});
  if (cnt !== 1) {
    throw new Meteor.Error(500, 'Could not update db');
  }
};

export default updateGithub;
