import {Meteor} from 'meteor/meteor';
import {Roles} from 'meteor/alanning:roles';
import {ACCOUNT_STATUS} from '/imports/lib/accountStatus';
import {updateAccountStatusAsync} from '/imports/server/collections/users';

const SETTABLE_STATUSES = [ACCOUNT_STATUS.ACTIVE, ACCOUNT_STATUS.SUSPENDED];

/**
 * Suspend or reactivate a user of the caller's company (Account admin only).
 *
 * accountStatus is write-locked for every in-process updateAsync (see
 * imports/server/collections/users.js); in the hosted product a separate admin
 * app writes it. CE has no such app, so this method is the one place that writes
 * it (updateAccountStatusAsync). Suspending also ends the user's sessions; the
 * login and method guards refuse the account from then on.
 *
 * @param {String} userId  the user to change
 * @param {String} status  'active' or 'suspended'
 * @returns {Promise<Number>} 1 when the user was changed
 */
const setAccountStatus = async function (userId, status) {
  const caller = await Meteor.userAsync();
  const companyId = caller && caller.profile && caller.profile.companyId;
  if (!companyId || !await Roles.userIsInRoleAsync(caller._id, ['account_admin'], companyId)) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  if (typeof userId !== 'string' || SETTABLE_STATUSES.indexOf(status) === -1) {
    throw new Meteor.Error(400, 'Invalid arguments');
  }
  if (userId === caller._id) {
    throw new Meteor.Error(400, 'You cannot change the status of your own account');
  }
  const inCompany = await Meteor.roleAssignment.findOneAsync({'user._id': userId, scope: companyId});
  const target = inCompany && await Meteor.users.findOneAsync(userId, {fields: {profile: 1}});
  if (!target) {
    throw new Meteor.Error(404, 'User not found');
  }
  const suspend = status === ACCOUNT_STATUS.SUSPENDED;
  const modifier = {$set: {
    accountStatus: status,
    accountStatusInfo: {
      action: suspend ? 'suspend' : 'reactivate',
      at: new Date(),
      by: {userId: caller._id, name: (caller.profile && (caller.profile.name || caller.profile.email)) || ''}
    }
  }};
  if (suspend) {
    modifier.$set['services.resume.loginTokens'] = [];
  }
  const updated = await updateAccountStatusAsync({_id: userId}, modifier);
  const name = (target.profile && (target.profile.name || target.profile.email)) || userId;
  await Meteor.callAsync('logEvent', caller,
    `User ${name} has been ${suspend ? 'suspended' : 'reactivated'}`, 'userUpdate');
  return updated;
};

export default setAccountStatus;
