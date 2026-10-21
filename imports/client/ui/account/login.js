/* global swal:false */

import {Template} from 'meteor/templating';
import {Session} from 'meteor/session';
import {Meteor} from 'meteor/meteor';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import {$} from 'meteor/jquery';
import { i18n } from 'meteor/universe:i18n';
import Notify from '/imports/api/notify';
import {Config} from '/imports/config';

function clearSession() {
  Session.keys = {}; // clear all session variables
}

function loginSuccess() {
  clearSession();
  Router.go('dashboard');
}

function prompt2faCode(username, password) {
  swal({
    title: i18n.__('TwoFactorAuthentication'),
    text: i18n.__('EnterCodeFromAuthenticatorApp'),
    type: 'input',
    inputType: 'text',
    showCancelButton: true,
    closeOnConfirm: false,
    confirmButtonText: i18n.__('Login'),
    cancelButtonText: i18n.__('Back'),
    inputPlaceholder: '6-digit code'
  }, function (code) {
    if (code === false) return; // cancelled
    if (!code || code.length < 6) {
      swal.showInputError(i18n.__('EnterCodeFromAuthenticatorApp'));
      return;
    }
    Meteor.loginWithPasswordAnd2faCode(username, password, code, function (error) {
      if (error) {
        swal.showInputError(i18n.__('InvalidTwoFactorCode'));
      } else {
        swal.close();
        loginSuccess();
      }
    });
  });
  // Style the input for numeric code entry
  Meteor.setTimeout(function () {
    let input = $('.sweet-alert input[type="text"]');
    if (input.length) {
      input.attr({maxlength: '6', inputmode: 'numeric', autocomplete: 'one-time-code'});
      input.css({'text-align': 'center', 'font-size': '24px', 'letter-spacing': '8px'});
      input.focus();
    }
  }, 100);
}

Template.login.onRendered(function () {
  if (Meteor.userId()) {
    Router.go('/dashboard');
  }
  $('#loginForm').validate({
    rules: {
      username: {
        required: true,
        email: true
      },
      password: {
        required: true
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
      let username = $('#username').val();
      let password = $('#password').val();

      Meteor.loginWithPassword(username, password, function (error) {
        if (error) {
          if (error.error === 'no-2fa-code') {
            Session.set('errorMsg', '');
            prompt2faCode(username, password);
          } else if (error.error === 'account-suspended') {
            Session.set('errorMsg', i18n.__('AccountSuspended'));
            Session.set('userName', username);
          } else {
            Session.set('errorMsg', i18n.__('UsernameAndPasswordMismatch'));
            Session.set('userName', username);
          }
        } else {
          loginSuccess();
        }
      });
    }
  });
});

Template.login.helpers({
  username: function () {
    return Session.get('userName');
  },
  registrationEnabled: function () {
    return Config.registrationEnabled;
  }
});

Template.login.events({
  'submit form': function (event) {
    event.preventDefault();
  },
  'click #cancel': function (event) {
    event.preventDefault();
    clearSession();
    Router.go('landing');
  },
  'click #register': function (event) {
    event.preventDefault();
    clearSession();
    Router.go('register');
  },
  'click #resetpwd': function (event, instance) {
    event.preventDefault();

    const validator = $('#loginForm').validate();

    if (validator) {
      validator.resetForm(); // clear previous errors

      if (validator.element('#username')) {    // validate the username element
        const username = instance.find('#username').value;

        Meteor.callAsync('resetUserPassword', username).then(function() {
          swal({
            title: i18n.__('ThankYou'),
            text: i18n.__('ResetPasswordInstruction'),
            type: 'success'
          });
          clearSession();
          Router.go('landing');
        }).catch(function(error) {
          Notify.danger(error.reason || error.message || 'Could not reset password');
        });
      }
    }
  }
});
