import {Meteor} from 'meteor/meteor';
import {Roles} from 'meteor/alanning:roles';
import Companies from '/imports/lib/collections/companies';
import {encrypt} from '/imports/lib/crypto';

const updateScanoss = async function (newSettings) {
  const user = await Meteor.userAsync();
  const companyId = user && user.profile && user.profile.companyId;
  if (!companyId || !await Roles.userIsInRole(user, ['account_admin'], user.profile.companyId)) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  // Blank token on save means "keep existing credential" (no longer published).
  if (Object.prototype.hasOwnProperty.call(newSettings, 'token')) {
    if (newSettings.token) {
      newSettings.token = encrypt(newSettings.token)
    } else {
      const company = await Companies.findOneAsync(companyId, {fields: {'scanoss.token': 1}});
      if (company && company.scanoss && company.scanoss.token) {
        newSettings.token = company.scanoss.token;
      } else {
        delete newSettings.token;
      }
    }
  }
  const cnt = await Companies.updateAsync(companyId, {$set: {'scanoss': newSettings}});
  if (cnt !== 1) {
    throw new Meteor.Error(500, 'Could not update db');
  }
};

export default updateScanoss;
