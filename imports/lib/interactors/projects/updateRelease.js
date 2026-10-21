import {Meteor} from 'meteor/meteor';
import {Roles} from 'meteor/alanning:roles';
import Projects from '/imports/lib/collections/projects';

const updateRelease = async function (projectId, release, action) {
  const user = await Meteor.userAsync();
  const companyId = user && user.profile && user.profile.companyId;
  if (!companyId || !await Roles.userIsInRole(user, ['account_admin', 'manager', 'compliance_manager'], companyId)) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  const project = await Projects.findOneAsync(projectId, {fields: {companyId: 1}});
  if (!project || project.companyId !== companyId) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  let modifier;
  if (action === 'push') {
    modifier = {$push: {release: release}};
  } else if (action === 'set') {
    modifier = {$set: {release: release}};
  } else {
    modifier = {$set: {release: release}};
  }
  const cnt = await Projects.updateAsync(projectId, modifier);
  if (cnt !== 1) {
    throw new Meteor.Error(500, 'Could not update db');
  }
};

export default updateRelease;
