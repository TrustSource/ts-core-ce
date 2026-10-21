import {Meteor} from 'meteor/meteor';
import {Roles} from 'meteor/alanning:roles';
import Companies from '/imports/lib/collections/companies';

const updateDefaultRootComponentLicense = async function (companyId, licenseKey) {
  const user = await Meteor.userAsync();
  const userCompanyId = user && user.profile && user.profile.companyId;
  if (!userCompanyId || userCompanyId !== companyId ||
      !await Roles.userIsInRole(user, ['account_admin', 'manager', 'compliance_manager'], userCompanyId)) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  const normalized = typeof licenseKey === 'string' ? licenseKey.trim() : '';
  if (normalized) {
    const company = await Companies.findOneAsync({_id: companyId}, {fields: {privateLicenses: 1}});
    const known = (company && company.privateLicenses || []).some(function (l) {
      return l && l.key === normalized;
    });
    if (!known) {
      throw new Meteor.Error(400, 'License key is not a private license of this company');
    }
  }
  const modifier = normalized
    ? {$set: {defaultRootComponentLicense: normalized}}
    : {$unset: {defaultRootComponentLicense: ''}};
  const cnt = await Companies.updateAsync(companyId, modifier);
  if (cnt !== 1) {
    throw new Meteor.Error(500, 'Could not update db');
  }
};

export default updateDefaultRootComponentLicense;
