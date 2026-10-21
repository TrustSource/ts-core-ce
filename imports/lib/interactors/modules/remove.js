import {Meteor} from 'meteor/meteor';
import {Roles} from 'meteor/alanning:roles';
import Modules from '/imports/lib/collections/modules';

const remove = async function (moduleId) {
  const user = await Meteor.userAsync();
  const companyId = user && user.profile && user.profile.companyId;
  if (!companyId || !await Roles.userIsInRole(user, ['account_admin', 'manager', 'developer', 'company_component_manager'], companyId)) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  const module = await Modules.findOneAsync(moduleId, {fields: {companyId: 1}});
  if (!module || module.companyId !== companyId) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  const cnt = await Modules.removeAsync(moduleId);
  if (cnt !== 1) {
    throw new Meteor.Error(500, 'Could not delete from db');
  }
};

export default remove;
