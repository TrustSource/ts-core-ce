import {Meteor} from 'meteor/meteor';
import {Roles} from 'meteor/alanning:roles';
import NoticeFilesUpdate from './update';

const BinaryLinkRemove = async function (_id, binaryLink) {
  const user = await Meteor.userAsync();
  if (!user || !await Roles.userIsInRole(user._id, ['compliance_manager', 'manager'], user.profile.companyId)) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  let {name, created} = binaryLink;
  let linkData = {
    name, created
  };
  let modifier = {
    '$pull': {
      binaryLinks: linkData
    }
  };
  return await NoticeFilesUpdate(modifier, _id)
};

export default BinaryLinkRemove;
