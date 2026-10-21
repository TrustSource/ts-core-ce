import {Meteor} from 'meteor/meteor';
import {Roles} from 'meteor/alanning:roles';
import SbomFiles from '/imports/lib/collections/sbomFiles';

const remove = async function (fileId) {
  const user = await Meteor.userAsync();
  const companyId = user && user.profile && user.profile.companyId;
  if (!companyId || !await Roles.userIsInRole(user, ['account_admin', 'manager', 'compliance_manager'], companyId)) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  const file = await SbomFiles.findOneAsync(fileId, {fields: {companyId: 1}});
  if (!file || file.companyId !== companyId) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  const cnt = await SbomFiles.removeAsync(fileId);
  if (cnt !== 1) {
    throw new Meteor.Error(500, 'Could not delete from db');
  }
};

export default remove;
