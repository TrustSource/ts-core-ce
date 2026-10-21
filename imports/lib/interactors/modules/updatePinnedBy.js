import {Meteor} from 'meteor/meteor';
import Modules from '/imports/lib/collections/modules';

const updatePinnedBy = async function (moduleId, pinnedBy) {
  const user = await Meteor.userAsync();
  const companyId = user && user.profile && user.profile.companyId;
  if (!companyId) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  const module = await Modules.findOneAsync(moduleId, {fields: {companyId: 1}});
  if (!module || module.companyId !== companyId) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  const cnt = await Modules.updateAsync(moduleId, {$set: {'relatedUsers.pinnedBy': pinnedBy}});
  if (cnt !== 1) {
    throw new Meteor.Error(500, 'Could not update db');
  }
};

export default updatePinnedBy;
