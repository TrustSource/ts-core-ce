import {Meteor} from 'meteor/meteor';
import {Roles} from 'meteor/alanning:roles';
import Companies from '/imports/lib/collections/companies';
import {REQUIRE_WHITELIST_ROLES} from '/imports/lib/company/settingsAccess';

const updateRequireWhitelist = async function (companyId, requireWhitelist) {
  const user = await Meteor.userAsync();
  const userCompanyId = user && user.profile && user.profile.companyId;
  if (!userCompanyId || userCompanyId !== companyId || !await Roles.userIsInRole(user, REQUIRE_WHITELIST_ROLES, userCompanyId)) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  const cnt = await Companies.updateAsync(companyId, {$set: {requireWhitelist: requireWhitelist}});
  if (cnt !== 1) {
    throw new Meteor.Error(500, 'Could not update db');
  }
};

export default updateRequireWhitelist;
