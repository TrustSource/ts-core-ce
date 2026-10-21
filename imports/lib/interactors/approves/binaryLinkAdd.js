import {Meteor} from 'meteor/meteor';
import {Roles} from 'meteor/alanning:roles';
import Utils from '/imports/lib/utils';
import ApprovesUpdate from './update';

const BinaryLinkAdd = async function (_id, binaryLink) {
  const user = await Meteor.userAsync();
  if (!user || !await Roles.userIsInRole(user._id, ['compliance_manager', 'manager'], user.profile.companyId)) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  let {name, comment} = binaryLink;
  let linkData = {
    name,
    comment,
    created: new Date(),
    userId: user._id,
    userName: Utils.username(user)
  };
  let modifier = {
    '$push': {
      binaryLinks: linkData
    }
  };
  return await ApprovesUpdate(modifier, _id)
};

export default BinaryLinkAdd;
