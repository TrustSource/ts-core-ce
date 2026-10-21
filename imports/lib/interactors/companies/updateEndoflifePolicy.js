import {Meteor} from 'meteor/meteor';
import {Roles} from 'meteor/alanning:roles';
import Companies from '/imports/lib/collections/companies';
import {ENDOFLIFE_POLICY_ROLES} from '/imports/lib/company/settingsAccess';

const updateEndoflifePolicy = async function (endoflifePolicy) {
  const user = await Meteor.userAsync();
  const companyId = user && user.profile && user.profile.companyId;
  if (!companyId || !await Roles.userIsInRole(user, ENDOFLIFE_POLICY_ROLES, companyId)) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  const cnt = await Companies.updateAsync(companyId, {$set: {endoflifePolicy: endoflifePolicy}});
  if (cnt !== 1) {
    throw new Meteor.Error(500, 'Could not update db');
  }
};

export default updateEndoflifePolicy;
