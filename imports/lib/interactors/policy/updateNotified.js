import {Meteor} from 'meteor/meteor';
import Policy from '/imports/lib/collections/policy';

const updateNotified = async function (policyId, notified) {
  const user = await Meteor.userAsync();
  const companyId = user && user.profile && user.profile.companyId;
  if (!companyId) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  const policy = await Policy.findOneAsync(policyId, {fields: {companyId: 1}});
  if (!policy || policy.companyId !== companyId) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  const cnt = await Policy.updateAsync(policyId, {$set: {notified: notified}});
  if (cnt !== 1) {
    throw new Meteor.Error(500, 'Could not update db');
  }
};

export default updateNotified;
