import {Meteor} from 'meteor/meteor';
import {Roles} from 'meteor/alanning:roles';
import Modules from '/imports/lib/collections/modules';
import {sanitizeModifier} from '/imports/lib/security/sanitizeModifier';

const updateCustomComponents = async function (moduleId, modifier) {
  const user = await Meteor.userAsync();
  const companyId = user && user.profile && user.profile.companyId;
  if (!companyId || !await Roles.userIsInRole(user, ['account_admin', 'manager', 'developer'], companyId)) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  const module = await Modules.findOneAsync(moduleId, {fields: {companyId: 1}});
  if (!module || module.companyId !== companyId) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  const cnt = await Modules.updateAsync(moduleId, sanitizeModifier(modifier));
  if (cnt !== 1) {
    throw new Meteor.Error(500, 'Could not update db');
  }
};

export default updateCustomComponents;
