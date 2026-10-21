/* global swal:false */

import {Template} from 'meteor/templating';
import {Session} from 'meteor/session';
import {Accounts} from 'meteor/accounts-base';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import {$} from 'meteor/jquery';
import Utils from '/imports/lib/utils';
import { i18n } from 'meteor/universe:i18n';

let registrationInProgress = false;

Template.register.onRendered(function () {

  Session.set('errorMsg', null);

  $.validator.addMethod('regex', function(value, element, regexpr) {
    return regexpr.test(value);
  }, i18n.__('YourTextDoesNotMatchRequirements'));

  $('#registerForm').validate({
    rules: {
      email: {
        required: true,
        email: true
      },
      email_repeat: {
        required: true,
        email: true,
        equalTo: '#email'
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
    errorElement: 'span',
    errorPlacement: function (error, element) {
      $(element)
        .closest('form')
        .find('label[for="' + element.attr('id') + '"]')
        .append(error);
    },
    submitHandler: function () {
      if (registrationInProgress) {
        return;
      }

      const email = $('#email').val(),
        password = $('#password').val();

      const newUser = {
        email: email,
        password: password,
        profile: {
          notifications : [
            'EVENTS_ALL',
            'ALARMS_ALL'
          ]
        }
      };
      registrationInProgress = true;
      $('#registerForm button[type="submit"]').prop('disabled', true);
      Accounts.createUser(newUser, function (error) {
        registrationInProgress = false;
        $('#registerForm button[type="submit"]').prop('disabled', false);
        if (error && error.reason !== 'Login forbidden') {
          Session.set('errorMsg', `${i18n.__('RegistrationError')}: ` + error.reason );
        } else {
          Session.set('errorMsg', null);
          swal({
            title: i18n.__('ThankYou'),
            text: i18n.__('AConfirmationEmailHasBeenSent'),
            type: 'success'
          });
          Router.go(error ? 'landing' : 'dashboard');
        }
      });
    }
  });

});

Template.register.onDestroyed(function () {
  Session.set('errorMsg', null);
});

Template.register.helpers({});

Template.register.events({
  'submit form': function (event) {
    event.preventDefault();
  }
});
