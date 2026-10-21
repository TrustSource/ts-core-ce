import {Meteor} from 'meteor/meteor';
import {Roles} from 'meteor/alanning:roles';
import Webhooks from '/imports/lib/collections/webhooks';

const remove = async function (_id) {
  const user = await Meteor.userAsync();
  if (!user || !await Roles.userIsInRole(user._id, ['account_admin', 'compliance_manager', 'manager'], user.profile.companyId)) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  if (typeof _id !== 'string') {
    throw new Meteor.Error(400, 'Invalid id');
  }
  let docId = await Webhooks.removeAsync({_id, companyId: user.profile.companyId});
  if(docId){
    await Meteor.callAsync('logEvent', user, 'Webhook removed', 'webhooksDeleted');
  }
  return docId
};

export default remove;
