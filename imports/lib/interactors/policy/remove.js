import {Meteor} from 'meteor/meteor';
import {Roles} from 'meteor/alanning:roles';
import Policy from '/imports/lib/collections/policy';

const remove = async function (policyId) {
  const user = await Meteor.userAsync();
  const companyId = user && user.profile && user.profile.companyId;
  if (!companyId || !await Roles.userIsInRole(user, ['account_admin', 'compliance_manager'], companyId)) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  const policy = await Policy.findOneAsync(policyId, {fields: {companyId: 1}});
  if (!policy || policy.companyId !== companyId) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  const cnt = await Policy.removeAsync(policyId);
  if (cnt !== 1) {
    throw new Meteor.Error(500, 'Could not delete from db');
  }
};

export default remove;
