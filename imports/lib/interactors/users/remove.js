import {Meteor} from 'meteor/meteor';
import {Roles} from 'meteor/alanning:roles';
import Companies from '/imports/lib/collections/companies';
import UsersExecuteRtbf from './executeRtbf';

const remove = async function (userId, companyId, params) {
  let callerId;
  // eslint-disable-next-line sonarjs/no-ignored-exceptions
  try { callerId = this && this.userId; } catch (e) { /* no method context */ }
  if (!callerId) {
    // eslint-disable-next-line sonarjs/no-ignored-exceptions
    try { const u = await Meteor.userAsync(); callerId = u && u._id; } catch (e) { /* no async user */ }
  }
  const user = callerId && await Meteor.users.findOneAsync(callerId);
  // User management is the Account admin's (UI and ROLES_AND_PERMISSIONS.md).
  const hasRole = user && user.profile && await Roles.userIsInRoleAsync(user._id, ['account_admin'], user.profile.companyId);
  if (!user || !user.profile || companyId !== user.profile.companyId || !hasRole) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  let changedUser = await Meteor.users.findOneAsync(userId);
  if (!changedUser || !changedUser.profile) {
    throw new Meteor.Error(404, 'User not found');
  }
  // With RTBF the audit entry must not keep the name either.
  const rtbf = params && params.rtbf && params.rtbf !== 'NO_TEXT_PROVIDED';
  let changedUserName = rtbf ? params.rtbf : (changedUser.profile.name || changedUser.profile.email);
  // Remove roles via Roles v4 API
  const userRolesInCompany = await Roles.getRolesForUserAsync(userId, {scope: companyId});
  if (userRolesInCompany.length > 0) {
    await Roles.removeUsersFromRolesAsync(userId, userRolesInCompany, {scope: companyId});
  }
  let remainingScopes = [];
  try {
    remainingScopes = await Roles.getScopesForUserAsync(userId);
  } catch (e) {
    console.log('[Users.Remove] getScopesForUserAsync error:', e.message);
  }
  let modifier = {};
  if(changedUser.profile.companyId === companyId || remainingScopes.length === 0) {
    modifier = {$unset: {'profile.companyId': true}};
  }
  let updatedUsers = Object.keys(modifier).length > 0
    ? await Meteor.users.updateAsync(userId, modifier)
    : 1;
  // The user's personal access keys stop working with the membership.
  await Companies.updateAsync({_id: companyId},
    {$set: {'apiKeys.$[key].published': false, 'apiKeys.$[key].unpublished': true}},
    {arrayFilters: [{'key.userId': userId}], bypassCollection2: true});
  if(updatedUsers > 0){
    await Meteor.callAsync('logEvent', user, 'User '+changedUserName+' has been removed from company', 'userUpdate');
  }else{
    await Meteor.callAsync('logEvent', user, 'Error: '+updatedUsers.message, 'userUpdate');
  }
  if(rtbf){
    await UsersExecuteRtbf.call(this, userId, companyId, params)
  }
  return updatedUsers
};

export default remove;
