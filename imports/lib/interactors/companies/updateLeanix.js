import {Meteor} from 'meteor/meteor';
import {Roles} from 'meteor/alanning:roles';
import Companies from '/imports/lib/collections/companies';
import {encrypt} from '/imports/lib/crypto';

const updateLeanix = async function (companyId, data) {
  const user = await Meteor.userAsync();
  const userCompanyId = user && user.profile && user.profile.companyId;
  if (!userCompanyId || userCompanyId !== companyId || !await Roles.userIsInRole(user, ['account_admin', 'manager'], userCompanyId)) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  // Only the leanix.* fields may be set here - never let a raw client object
  // $set arbitrary company fields (accountType, apiKeys, ...) = mass assignment.
  const allowed = ['leanix.companyName', 'leanix.token'];
  const set = {};
  for (const key of Object.keys(data || {})) {
    if (allowed.indexOf(key) === -1) {
      throw new Meteor.Error(400, 'Invalid field');
    }
    // Blank token on save means "keep the existing credential" (no longer published).
    if (key === 'leanix.token' && !data[key]) {
      continue;
    }
    // The token is stored encrypted, like the other integration credentials.
    set[key] = key === 'leanix.token' ? encrypt(String(data[key])) : data[key];
  }
  if (Object.keys(set).length === 0) {
    return;
  }
  const cnt = await Companies.updateAsync(companyId, {$set: set});
  if (cnt !== 1) {
    throw new Meteor.Error(500, 'Could not update db');
  }
};

export default updateLeanix;
