import {Meteor} from 'meteor/meteor';
import {Roles} from 'meteor/alanning:roles';
import Tags from '/imports/lib/collections/tags';

const reactivate = async function (_id, name) {
  const user = await Meteor.userAsync();
  if (!user || !await Roles.userIsInRole(user._id, ['account_admin', 'manager'], user.profile.companyId)) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  if (typeof _id !== 'string') {
    throw new Meteor.Error(400, 'Invalid id');
  }
  let tagId = await Tags.updateAsync({_id, companyId: user.profile.companyId}, {$unset:{deleted: true}});
  if(tagId){
    await Meteor.callAsync('logEvent', user, 'Tag '+ name +' reactivated', 'tagsUpdated');
  }
  return tagId
};

export default reactivate;
