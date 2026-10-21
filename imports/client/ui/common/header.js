/* global window:false */

import {Template} from 'meteor/templating';
import {Meteor} from 'meteor/meteor';
import {$} from 'meteor/jquery';
import _ from 'underscore';
import {Roles} from 'meteor/alanning:roles';
import UserExtUtils from '/imports/lib/userExtUtils';


Template.header.events({
  'click .hide-menu': function (event) {

    event.preventDefault();

    if ($(window).width() < 769) {
      $('body').toggleClass('show-sidebar');
    } else {
      $('body').toggleClass('hide-sidebar');
    }
  }
});
Template.header.helpers({
  isSuperUser: function () {
    let user = Meteor.user();
    if(user && user.profile){
      let companyId = user.profile.companyId;
      const roles = Roles.getRolesForUser(user, {scope: companyId});
      return UserExtUtils.isSuperUser(roles);
    }
  },
  userDisplayName: function () {
    return UserExtUtils.username();
  },
  userRoles: function () {
    const user = Meteor.user();
    const companyId = user && user.profile && user.profile.companyId;
    const roles = companyId ? Roles.getRolesForUser(user, {scope: companyId}) : [];
    return _.chain(roles)
      .map(function (role) {
        const roleDetails = _.find(UserExtUtils.allRoles(), function (availableRole) {
          return availableRole.key === role;
        });
        return roleDetails && roleDetails.label;
      })
      // Drop roles with no display label (e.g. the system-only `admin` role,
      // which is intentionally absent from allRoles()) so they don't render as
      // empty segments - otherwise the join produces "Account admin, , ...".
      .filter(Boolean)
      .value()
      .join(', ');
  }
});
