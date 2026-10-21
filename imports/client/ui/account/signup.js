/* global swal:false */

import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {Session} from 'meteor/session';
import {Accounts} from 'meteor/accounts-base';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import {$} from 'meteor/jquery';
import Utils from '/imports/lib/utils';
import {userNameProblem, normalizeUserName, USER_NAME_MESSAGES} from '/imports/lib/user/nameValidation';

let doneCallback;

Accounts.onEnrollmentLink(function (rawToken, done) {
  const token = decodeURIComponent(rawToken);
  Session.set('enrollEmailToken', token);
  Meteor.callAsync('getUserInfoByToken', token).then(function(user) {
    if (user) {
      Session.set('user', user);
      Meteor.callAsync('logEvent', user, 'User '+user.profile.name+' ('+user.profile.email+') has successfully accepted invitation',
        'userInvitationAccepted').catch(function() {});
    } else {
      Meteor.callAsync('logEvent', 'system', 'Enrollment token not found', 'userInvitationAccepted').catch(function() {});
    }
  }).catch(function(error) {
    console.error('getUserInfoByToken failed:', error);
  });
  doneCallback = done;
});

function endEnrollmentSessionAndGoHome() {
  if (doneCallback) {
    doneCallback();
  }
  Session.set('enrollEmailToken', null);
  Router.go('home');
}

// Rendered
Template.signup.onRendered(function () {

  $.validator.addMethod('regex', function(value, element, regexpr) {
    return regexpr.test(value);
  }, 'Your text does not match requirements');

  // Validate 1.14 does not trim, so `required` and `minlength` let a whitespace-only
  // name through; check the trimmed name with the same rule and message as Profile.
  $.validator.addMethod('userName', function (value) {
    return userNameProblem(value) === null;
  }, function (params, element) {
    return USER_NAME_MESSAGES[userNameProblem($(element).val())];
  });

  $('#signupForm').validate({
    rules: {
      name: {
        required: true,
        userName: true
      },
      password: {
        required: true,
        minlength: 12,
        regex: Utils.PaswordRegExp
      },
      password_repeat: {
        required: true,
        equalTo: '#password',
        minlength: 12,
        regex: Utils.PaswordRegExp
      }
    },
    messages: {
      name: {
        required: USER_NAME_MESSAGES.empty
      }
    },
    errorElement: 'span',
    errorPlacement: function (error, element) {
      $(element)
        .closest('form')
        .find('label[for="' + element.attr('id') + '"]')
        .append(error);
    },
    submitHandler: function () {
      const password = $('#password').val();
      const name = normalizeUserName($('#name').val());

      Accounts.resetPassword(Session.get('enrollEmailToken'), password, function (error) {
        console.log('Accounts.resetPassword-callback', error);
        if (error) {
          if (error.message === 'Token expired [403]') {
            swal({
              title: 'Error!',
              text: 'Sorry, this link has expired!',
              type: 'error'
            });
            endEnrollmentSessionAndGoHome();
          } else {
            swal({
              title: 'Error!',
              text: 'Sorry, there is a problem activating your account!',
              type: 'error'
            });
          }
        } else {
          swal({
            title: 'OK!',
            text: 'Your account has has been activated!',
            type: 'success'
          });
          if (name) {
            const userId = Meteor.userId();
            if (userId) {
              Meteor.users.updateAsync(userId, {'$set': {'profile.name':name}});
            }
          }
          endEnrollmentSessionAndGoHome();
        }
      });
    }
  });
});

// Helpers
Template.signup.helpers({
  userName: function () {
    const user = Session.get('user');

    return user && user.profile && user.profile.name ? user.profile.name : '';
  },
  companyName: function () {
    const user = Session.get('user');
    return user && user.company && user.company.name ? user.company.name : '';
  }
});

// Events
Template.signup.events({
  /**
   * submit should be handled by jQuery.validate
   */
  'submit #signupForm': function (event) {
    event.preventDefault();
  }
});
