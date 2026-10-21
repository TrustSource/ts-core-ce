/* global swal:false */

import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {Session} from 'meteor/session';
import {Accounts} from 'meteor/accounts-base';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import {$} from 'meteor/jquery';
import Utils from '/imports/lib/utils';

let doneCallback;

Accounts.onResetPasswordLink(function (rawToken, done) {
  Session.set('resetPasswordToken', decodeURIComponent(rawToken));
  doneCallback = done;
});

function endResetSessionAndGoHome() {
  if (doneCallback) {
    doneCallback();
  }
  Session.set('resetPasswordToken', null);
  Router.go('home');
}

Template.resetPassword.onRendered(function () {

  $.validator.addMethod('regex', function(value, element, regexpr) {
    return regexpr.test(value);
  }, 'Your text does not match requirements');

  $('#resetPasswordForm').validate({
    rules: {
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
    errorElement: 'span',
    errorPlacement: function (error, element) {
      $(element)
        .closest('form')
        .find('label[for="' + element.attr('id') + '"]')
        .append(error);
    },
    submitHandler: function () {
      const password = $('#password').val();
      Accounts.resetPassword(Session.get('resetPasswordToken'), password, function (error) {
        console.log('Accounts.resetPassword-callback', error);
        if (error) {
          Meteor.callAsync('logEvent', 'system', 'Password reset error: ' + error.message +
            ', token: ' + Session.get('resetPasswordToken'), 'emailReset').catch(function() {});
          if (error.message === 'Token expired [403]') {
            swal({
              title: 'Error!',
              text: 'Sorry, this link has expired!',
              type: 'error'
            });
            endResetSessionAndGoHome();
          } else {
            swal({
              title: 'Error!',
              text: 'Sorry, there was a problem resetting your password!',
              type: 'error'
            });
          }
        } else {
          Meteor.callAsync('logEvent', 'system', 'Password reset successful, token: ' + Session.get('resetPasswordToken'), 'emailReset').catch(function() {});
          swal({
            title: 'OK!',
            text: 'Your password has been changed!',
            type: 'success'
          });
          endResetSessionAndGoHome();
        }
      });
    }
  });
});

/** not active??? */
Template.resetPassword.events({
  /**
   * submit should be handled by jQuery.validate
   */
  'submit form': function (event) {
    event.preventDefault();
  },
  'click #cancel': function (event) {
    event.preventDefault();
    endResetSessionAndGoHome();
  }
});
