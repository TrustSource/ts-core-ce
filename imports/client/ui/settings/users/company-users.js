/* global swal:false */

import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {Session} from 'meteor/session';
import _ from 'underscore';
import {$} from 'meteor/jquery';
import Notify from '/imports/api/notify';
import {Roles} from 'meteor/alanning:roles';
import UserExtUtils from '/imports/lib/userExtUtils';

function noVerifiedEmail(user) {
  return _.every(user.emails, function (item) {
    return item.verified;
  });
}

function setAccountStatus(user, status) {
  const name = (user.profile && (user.profile.name || user.profile.email)) || user._id;
  Meteor.callAsync('Users.SetAccountStatus', user._id, status).then(function () {
    Notify.success('User ' + name + (status === 'suspended' ? ' was suspended' : ' was reactivated'));
  }).catch(function (error) {
    Notify.danger(error.reason || error.message);
  });
}

Template.companyUsers.onRendered(function () {
  this.autorun(function () {
    let users = Meteor.users.find().fetch();
    // Also track role assignments so select2 re-initializes when roles arrive
    Meteor.roleAssignment.find().fetch();
    if (users.length) {
      Meteor.defer(function () {
        $('select.select2:visible').select2({width: '100%'});
      });
    }
  });
  $('[data-toggle="popover"]').popover()
});

Template.companyUsers.helpers({
  getCompanyUsers: function () {
    return Meteor.users.find({}, {sort: {'profile.name': 1}});
  },
  isUserInRole: function (role, companyId) {
    const user = this;
    return Roles.userIsInRole(user, [role], companyId);
  },
  getLogin: function () {
    const user = this;
    return (user.emails && user.emails[0] && user.emails[0].address) ||
      (user && user.profile && user.profile.login)
  },
  mismatchedEmail: function () {
    const user = this;
    const profileEmail = user && user.profile && user.profile.email
    const authEmail = (user.emails && user.emails[0] && user.emails[0].address) ||
      (user && user.profile && user.profile.login)
    return profileEmail !== authEmail ? profileEmail : false;
  },
  getName: function () {
    const user = this;
    return user && user.profile && (user.profile.name || user.profile.email);
  },
  getUserEmails: function () {
    const user = this;
    return user.emails;
  },
  isVarifiedDisabledAttr: function () {
    if (this.verified) {
      return 'disabled';
    }
  },
  moreThanOneEmail: function () {
    const user = this;
    return user.emails && user.emails.length > 1;
  },
  resendButtonDisabledAttr: function () {
    let currentUser = Meteor.user();
    if ((currentUser && currentUser._id === this._id) || noVerifiedEmail(this)) {
      return 'disabled';
    }
  },

  getManagerEmail: function () {
    let user = Meteor.user();
    const companyId = user && user.profile && user.profile.companyId;
    if (!companyId) return '';
    const users = Meteor.users.find({}, {sort: {'profile.name': 1}}).fetch();
    const admin = _.find(users, function (item) {
      return Roles.userIsInRole(item, ['manager'], companyId);
    });
    if (admin && admin.profile) {
      return admin.profile.email
    } else {
      return ''
    }
  },

  getManagerName: function () {
    let user = Meteor.user();
    const companyId = user && user.profile && user.profile.companyId;
    if (!companyId) return 'your company admin';
    const users = Meteor.users.find({}, {sort: {'profile.name': 1}}).fetch();
    const admin = _.find(users, function (item) {
      return Roles.userIsInRole(item, ['manager'], companyId);
    });
    if (admin && admin.profile) {
      return admin.profile.name
    } else {
      return 'your company admin'
    }
  },

  companyId: function () {
    let user = Meteor.user();
    return user && user.profile && user.profile.companyId
  },

  isSelectedValue: function (value) {
    const user = Template.parentData(1);
    const currentUser = Meteor.user();
    const companyId = currentUser && currentUser.profile.companyId;
    $('.select2').trigger('change.select2');
    if (user && companyId) {
      return Roles.userIsInRole(user, [value], companyId) ? 'selected' : false;
    }
  },

  getRolesSchema: function () {
    return UserExtUtils.availableRoles()
  },

  has2fa: function () {
    const twoFactor = this.services && this.services.twoFactorAuthentication;
    return !!(twoFactor && twoFactor.type === 'otp');
  },

  isSuspended: function () {
    return this.accountStatus === 'suspended' || this.accountStatus === 'suspicious';
  },

  isCurrentUser: function () {
    const user = this;
    const currentUser = Meteor.user();
    return user._id === currentUser._id ? 'disabled' : false
  }
});

Template.companyUsers.events({
  'change .on_update_field': function (event) {
    const currentUser = Meteor.user();
    const user = this;
    const value = $(event.target).val();
    let roleList = [];
    if (Array.isArray(value)) {
      roleList = value;
    } else if (value) {
      roleList = [value];
    }
    // select2 returns [] once the last tag is removed, which is truthy, so the
    // old `if (value)` sent an empty set that the server rejects (Invalid role)
    // while the widget already showed no roles - a false, out-of-sync display.
    // A user must keep at least one role: revert the widget to the stored roles
    // and point the admin at Remove for the "take the user out" intent.
    if (!roleList.length) {
      const companyId = currentUser && currentUser.profile && currentUser.profile.companyId;
      const currentRoles = companyId ? Roles.getRolesForUser(user, {scope: companyId}) : [];
      $(event.target).val(currentRoles).trigger('change.select2');
      Notify.warn('A user must have at least one role. Use the Remove button to take the user out of the company.');
      return;
    }
    if(UserExtUtils.isSuperUser(roleList)){
      Notify.warn('PLEASE NOTE: You are about to allow this user god-like privileges. ' +
        'All compliance procedures live from shared responsibilities. ' +
        'This overrules the shared responsibility model. It has been invented just for testing purposes!');
      Meteor.callAsync('notifyAboutSuperUser')
    }
    Meteor.callAsync('setUserRole', user._id, roleList).then(function () {
      let changedUser = Meteor.users.findOne(user._id);
      let changedUserName = changedUser && changedUser.profile ? (changedUser.profile.name || changedUser.profile.email) : user._id;
      Meteor.callAsync('logEvent', currentUser, 'Role for user ' + changedUserName + ' changed to ' + roleList.join(','), 'userUpdate');
      Notify.success('User ' + changedUserName + ' role changed');
    }).catch(function (error) {
      Meteor.callAsync('logEvent', currentUser, 'Error: ' + error.message, 'userUpdate');
      Notify.danger(error.message);
    });
  },
  'click .resend': function (event) {
    let user = Meteor.user();
    const name = this.profile.name;
    let email;
    if (this.emails.length > 1) {
      email = $(event.target).parents('.input-group').find('select').val();
    } else {
      email = this.emails[0].address;
    }
    Meteor.callAsync('resendEnrollmentEmail', email).then(function() {
      Meteor.callAsync('logEvent', user, 'Invitation for user ' + name + ' has been resend', 'userUpdate');
      Notify.success('Invitation was resend to user ' + name);
    }).catch(function(error) {
      Meteor.callAsync('logEvent', user, 'Error: ' + error.message, 'userUpdate');
      Notify.danger(error.reason);
    });
  },
  'click .remove-rtbf': function (event) {
    event.preventDefault();
    let userId = this._id;
    const company = Session.get('company');
    let changedUser = Meteor.users.findOne(userId);
    let changedUserName = changedUser.profile.name || changedUser.profile.email;

    swal({
      title: 'You decided to remove the user with RTBF',
      text: 'RTBF is the right to have private information about a person be removed. ' +
        'Please fill replacement for user personal data or just keep it empty for text "RTBF_USED"',
      type: 'input',
      showCancelButton: true,
      confirmButtonColor: '#cf4747',
      confirmButtonText: 'Yes, remove it!'
    },function (reason) {
      if (reason === false) return false;
      if (!reason) {
        reason = 'RTBF_USED';
      }
      Meteor.callAsync('Users.Remove', userId, company._id, {rtbf: reason}).then(function(data) {
        if (data === 1) {
          Meteor.users._collection.remove(userId);
          Notify.success('User ' + changedUserName + ' was removed');
        }
      }).catch(function(error) {
        Notify.danger(error.message);
      });
    });
  },

  'click .reset-2fa': function (event) {
    event.preventDefault();
    const user = this;
    const name = (user.profile && (user.profile.name || user.profile.email)) || user._id;
    swal({
      title: 'Reset two-factor authentication of ' + name + '?',
      text: 'The user signs in with the password only and can set up 2FA again in the profile.',
      showCancelButton: true,
      confirmButtonColor: '#cf4747',
      confirmButtonText: 'Yes, reset it'
    }, function (confirmed) {
      if (confirmed === false) return false;
      Meteor.callAsync('Users.Reset2fa', user._id).then(function () {
        Notify.success('Two-factor authentication of ' + name + ' was reset');
      }).catch(function (error) {
        Notify.danger(error.reason || error.message);
      });
    });
  },

  'click .suspend': function (event) {
    event.preventDefault();
    setAccountStatus(this, 'suspended');
  },

  'click .reactivate': function (event) {
    event.preventDefault();
    setAccountStatus(this, 'active');
  },

  'click .remove': function (event) {
    event.preventDefault();
    let userId = this._id;
    const company = Session.get('company');
    let changedUser = Meteor.users.findOne(userId);
    let changedUserName = changedUser.profile.name || changedUser.profile.email;

    Meteor.callAsync('Users.Remove', userId, company._id).then(function(data) {
      if (data === 1) {
        Meteor.users._collection.remove(userId);
        Notify.success('User ' + changedUserName + ' was removed');
      }
    }).catch(function(error) {
      Notify.danger(error.message);
    });
  }
});
