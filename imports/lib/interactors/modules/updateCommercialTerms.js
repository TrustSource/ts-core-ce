import {Meteor} from 'meteor/meteor';
import {Roles} from 'meteor/alanning:roles';
import Modules from '/imports/lib/collections/modules';

const updateCommercialTerms = async function (moduleId, field, value) {
  const user = await Meteor.userAsync();
  const companyId = user && user.profile && user.profile.companyId;
  if (!companyId || !await Roles.userIsInRole(user, ['account_admin', 'manager', 'compliance_manager'], companyId)) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  const module = await Modules.findOneAsync(moduleId, {fields: {companyId: 1}});
  if (!module || module.companyId !== companyId) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  // P5: `field` is a client-supplied modifier key. Confine it to the
  // commercialTerms sub-document so it can't re-tenant the module
  // (`field='companyId'`) or pollute the prototype chain.
  if (typeof field !== 'string' || !/^commercialTerms\.[A-Za-z]\w*$/.test(field)) {
    throw new Meteor.Error(400, 'Invalid field');
  }
  const cnt = await Modules.updateAsync(moduleId, {$set: {[field]: value}});
  if (cnt !== 1) {
    throw new Meteor.Error(500, 'Could not update db');
  }
};

export default updateCommercialTerms;
