import {Meteor} from 'meteor/meteor';
import Projects from '/imports/lib/collections/projects';

const updatePinnedBy = async function (projectId, pinnedBy) {
  const user = await Meteor.userAsync();
  const companyId = user && user.profile && user.profile.companyId;
  if (!companyId) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  const project = await Projects.findOneAsync(projectId, {fields: {companyId: 1}});
  if (!project || project.companyId !== companyId) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  const cnt = await Projects.updateAsync(projectId, {$set: {'relatedUsers.pinnedBy': pinnedBy}});
  if (cnt !== 1) {
    throw new Meteor.Error(500, 'Could not update db');
  }
};

export default updatePinnedBy;
