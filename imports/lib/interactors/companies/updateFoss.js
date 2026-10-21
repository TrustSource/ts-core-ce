import {Meteor} from 'meteor/meteor';
import {Roles} from 'meteor/alanning:roles';
import Companies from '/imports/lib/collections/companies';
import {stripProtectedCompanyFields} from '/imports/lib/interactors/companies/protectedFields';

const updateFoss = async function (companyId, data) {
  const user = await Meteor.userAsync();
  const userCompanyId = user && user.profile && user.profile.companyId;
  if (!userCompanyId || userCompanyId !== companyId || !await Roles.userIsInRole(user, ['account_admin', 'manager'], userCompanyId)) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  // Never let a client-shaped object write provisioning-only fields
  // (tenantId/realmId/providerId/enterprise/allowedLicenses). If nothing remains
  // after stripping, skip the write (an empty $set is rejected by Mongo).
  const safeData = stripProtectedCompanyFields(data);
  if (!safeData || typeof safeData !== 'object' || Array.isArray(safeData) || !Object.keys(safeData).length) {
    return;
  }
  const cnt = await Companies.updateAsync(companyId, {$set: safeData});
  if (cnt !== 1) {
    throw new Meteor.Error(500, 'Could not update db');
  }
};

export default updateFoss;
