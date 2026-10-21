/* global swal:false, Package:false */

import {Template} from 'meteor/templating';
import {Session} from 'meteor/session';
import {Accounts} from 'meteor/accounts-base';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import {Meteor} from 'meteor/meteor';
import {$} from 'meteor/jquery';
import Notify from '/imports/api/notify';

let doneCallback;

Accounts.onEmailVerificationLink(function (token, done) {
  Session.set('verifyEmailToken', token);
  doneCallback = done;
});

function endVerifySessionAndGoHome() {
  if (doneCallback) {
    doneCallback();
  }
  Session.set('verifyEmailToken', null);
  Router.go('home');
}

Template.verifyEmail.onRendered(function () {
  Session.set('errorMsg', null);
});

Template.verifyEmail.onDestroyed(function () {
  Session.set('errorMsg', null);
});

Template.verifyEmail.helpers({});

const SwalTempl = {
  expired: {
    title: 'Error!',
    text: 'Sorry, this link has expired!',
    type: 'error'
  },
  genericError: {
    title: 'Error!',
    text: 'Sorry, there was a problem confirming your e-mail!',
    type: 'error'
  },
  ok: {
    title: 'OK!',
    text: 'Your e-mail has been verified!',
    type: 'success'
  }
};

Template.verifyEmail.events({
  'submit form': function (event) {
    const password = $('#password').val();
    const token = Session.get('verifyEmailToken');
    event.preventDefault();

    if (!token) {
      return;
    }
    if (!password) {
      Session.set('errorMsg', 'Password missing');
      return;
    }
    const digest = Package.sha.SHA256(password);
    Meteor.callAsync('verifyUserPassword', token, digest).then(function(result) {
      console.log('verifyUserPassword-callback', result);
      if (result === false) {
        Session.set('errorMsg', 'wrong password');
      } else {
        Accounts.verifyEmail(token, function (error) {
          console.log('Accounts.verifyEmailToken-callback', error, (error || {}).message);

          if (error) {
            if (error.message === 'Verify email link expired [403]') {
              Notify.success(SwalTempl.expired.text);
              endVerifySessionAndGoHome();
            } else {
              Notify.success(SwalTempl.genericError.text);
            }
          } else {
            Notify.success(SwalTempl.ok.text);
            endVerifySessionAndGoHome();
          }
        });
      }
    }).catch(function(error) {
      console.log('verifyUserPassword-callback', error);
      Notify.success(SwalTempl.expired.text);
      console.log('Link expired going home...');
      endVerifySessionAndGoHome();
    });
  },

  'click #cancel': function (event) {
    event.preventDefault();
    endVerifySessionAndGoHome();
  },

  'click #resetpwd': function (event) {
    event.preventDefault();
    Meteor.callAsync('resetPasswordByToken', Session.get('verifyEmailToken')).then(function() {
      swal({
        title: 'Thank You!',
        text: 'An e-mail with reset password instruction has been sent to your e-mail address. '
        + 'Please check your e-mail and follow the provided instructions! '
        + 'If you do not receive any e-mail within 5 minutes, please try again or check your SPAM folder.',
        type: 'success'
      });
      endVerifySessionAndGoHome()
    }).catch(function(error) {
      Notify.danger(error.reason || error.message || 'Could not reset password');
    });
  }
});
