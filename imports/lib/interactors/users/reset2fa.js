import {Meteor} from 'meteor/meteor';
import {Roles} from 'meteor/alanning:roles';

/**
 * Turn off two-factor authentication for a user of the caller's company (Account
 * admin only), for a user who lost their authenticator. They sign in with their
 * password and can set 2FA up again in their profile.
 *
 * @param {String} userId
 * @returns {Promise<Number>} 1 when 2FA was turned off, 0 when it was not set up
 */
const reset2fa = async function (userId) {
  const caller = await Meteor.userAsync();
  const companyId = caller && caller.profile && caller.profile.companyId;
  if (!companyId || !await Roles.userIsInRoleAsync(caller._id, ['account_admin'], companyId)) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  if (typeof userId !== 'string' || userId === caller._id) {
    // The own 2FA is turned off in the profile, which asks for the current code.
    throw new Meteor.Error(400, 'Invalid user');
  }
  const inCompany = await Meteor.roleAssignment.findOneAsync({'user._id': userId, scope: companyId});
  const target = inCompany && await Meteor.users.findOneAsync(userId,
    {fields: {profile: 1, 'services.twoFactorAuthentication.type': 1}});
  if (!target) {
    throw new Meteor.Error(404, 'User not found');
  }
  const updated = await Meteor.users.updateAsync(
    {_id: userId, 'services.twoFactorAuthentication': {$exists: true}},
    {$unset: {'services.twoFactorAuthentication': 1}});
  if (updated) {
    const name = (target.profile && (target.profile.name || target.profile.email)) || userId;
    await Meteor.callAsync('logEvent', caller, `Two-factor authentication of user ${name} has been reset`,
      'userUpdate');
  }
  return updated;
};

export default reset2fa;
