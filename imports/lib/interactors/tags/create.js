import {Meteor} from 'meteor/meteor';
import {Roles} from 'meteor/alanning:roles';
import Tags from '/imports/lib/collections/tags';
import Utils from '/imports/lib/utils';

const create = async function ({name, description}) {
  let user = await Meteor.userAsync();
  if (!user || !await Roles.userIsInRole(user._id, ['account_admin', 'manager'], user.profile.companyId)) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  const companyId = user.profile.companyId;
  let doc = {
    created: new Date(),
    companyId: companyId,
    userId: user._id,
    userName: Utils.username(user),
    name: name,
    description: description
  };
  let tagId = await Tags.insertAsync(doc);
  if(tagId){
    await Meteor.callAsync('logEvent', user, 'Tag ' + name, 'tagsCreate');
  }
  return tagId
};

export default create;
