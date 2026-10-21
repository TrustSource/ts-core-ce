import {Meteor} from 'meteor/meteor';
import {Roles} from 'meteor/alanning:roles';
import SbomFilesUpdate from './update';

const freeze = async function (_id) {
  const user = await Meteor.userAsync();
  if (!user || !await Roles.userIsInRole(user._id, ['compliance_manager', 'manager'], user.profile.companyId)) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  const modifier = {
    '$set': {
      disabled: new Date()
    }
  };
  return await SbomFilesUpdate(modifier, _id);
};

export default freeze;
