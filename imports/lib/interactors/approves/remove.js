import {Meteor} from 'meteor/meteor';
import {Roles} from 'meteor/alanning:roles';
import Approves from '/imports/lib/collections/approves';

const remove = async function (_id) {
  const user = await Meteor.userAsync();
  if (!user || !await Roles.userIsInRole(user._id, ['compliance_manager', 'manager'], user.profile.companyId)) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  if (typeof _id !== 'string') {
    throw new Meteor.Error(400, 'Invalid id');
  }
  let approveId = await Approves.removeAsync({_id, companyId: user.profile.companyId});
  if(approveId){
    await Meteor.callAsync('logEvent', user, 'Approval removed', 'approveRemove');
  }
  return approveId
};

export default remove;
