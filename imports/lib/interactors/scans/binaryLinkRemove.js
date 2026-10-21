import {Meteor} from 'meteor/meteor';
import {Roles} from 'meteor/alanning:roles';
import ScanUpdate from './update';

const BinaryLinkRemove = async function (_id, binaryLink) {
  const user = await Meteor.userAsync();
  if (!user || !await Roles.userIsInRole(user._id, ['developer', 'compliance_manager', 'manager'], user.profile.companyId)) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  if (!_id) {
    throw new Meteor.Error(400, 'ScanId was not provided!');
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
  return ScanUpdate(modifier, _id)
};

export default BinaryLinkRemove;
