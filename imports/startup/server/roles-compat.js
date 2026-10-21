/**
 * Backwards-compat shim for alanning:roles 4.0
 * In roles 4.0, sync methods were removed from the server.
 * This shim adds async versions with the old names.
 * All callers on the server must use `await`.
 */
import { Meteor } from 'meteor/meteor';
import { Roles } from 'meteor/alanning:roles';

if (Meteor.isServer) {
  // userIsInRole -> userIsInRoleAsync (most commonly used)
  if (!Roles.userIsInRole && Roles.userIsInRoleAsync) {
    Roles.userIsInRole = async function (user, roles, options) {
      return await Roles.userIsInRoleAsync(user, roles, options);
    };
  }

  // getUsersInRole -> getUsersInRoleAsync
  if (!Roles.getUsersInRole && Roles.getUsersInRoleAsync) {
    Roles.getUsersInRole = function (roles, options, queryOptions) {
      return Roles.getUsersInRoleAsync(roles, options, queryOptions);
    };
  }

  // addUsersToRoles -> addUsersToRolesAsync
  if (!Roles.addUsersToRoles && Roles.addUsersToRolesAsync) {
    Roles.addUsersToRoles = function (users, roles, options) {
      return Roles.addUsersToRolesAsync(users, roles, options);
    };
  }

  // setUserRoles -> setUserRolesAsync
  if (!Roles.setUserRoles && Roles.setUserRolesAsync) {
    Roles.setUserRoles = function (users, roles, options) {
      return Roles.setUserRolesAsync(users, roles, options);
    };
  }

  // removeUsersFromRoles -> removeUsersFromRolesAsync
  if (!Roles.removeUsersFromRoles && Roles.removeUsersFromRolesAsync) {
    Roles.removeUsersFromRoles = function (users, roles, options) {
      return Roles.removeUsersFromRolesAsync(users, roles, options);
    };
  }

  // createRole -> createRoleAsync
  if (!Roles.createRole && Roles.createRoleAsync) {
    Roles.createRole = function (roleName, options) {
      return Roles.createRoleAsync(roleName, options);
    };
  }

  // deleteRole -> deleteRoleAsync
  if (!Roles.deleteRole && Roles.deleteRoleAsync) {
    Roles.deleteRole = function (roleName) {
      return Roles.deleteRoleAsync(roleName);
    };
  }

  // getRolesForUser -> getRolesForUserAsync
  if (!Roles.getRolesForUser && Roles.getRolesForUserAsync) {
    Roles.getRolesForUser = function (user, options) {
      return Roles.getRolesForUserAsync(user, options);
    };
  }

  // getAllRoles
  if (!Roles.getAllRoles) {
    Roles.getAllRoles = function (queryOptions) {
      const collection = Meteor.roles;
      return collection.find({}, queryOptions || {});
    };
  }
}
