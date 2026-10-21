import {Meteor} from 'meteor/meteor';
import {Roles} from 'meteor/alanning:roles';
import Modules from '/imports/lib/collections/modules';

const updateEnvironmentalConfig = async function (moduleId, environmentalConfig, reset) {
  const user = await Meteor.userAsync();
  const companyId = user && user.profile && user.profile.companyId;
  if (!companyId || !await Roles.userIsInRole(user, ['account_admin', 'manager', 'compliance_manager'], companyId)) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  const module = await Modules.findOneAsync(moduleId, {fields: {companyId: 1}});
  if (!module || module.companyId !== companyId) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  let modifier;
  if (reset) {
    modifier = {$unset: {environmentalConfig: true}, $set: {analysisRequired: true}};
  } else {
    modifier = {$set: {environmentalConfig: environmentalConfig, analysisRequired: true}};
  }
  const cnt = await Modules.updateAsync(moduleId, modifier);
  if (cnt !== 1) {
    throw new Meteor.Error(500, 'Could not update db');
  }
};

export default updateEnvironmentalConfig;
