import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {ReactiveVar} from 'meteor/reactive-var';
import {$} from 'meteor/jquery';
import Notify from '/imports/api/notify';
import {UserSchema} from '/imports/lib/schemas/userSchema';
import {userNameProblem, normalizeUserName, USER_NAME_MESSAGES} from '/imports/lib/user/nameValidation';

Template.companyUsersInvite.onCreated(function () {
  this.nameError = new ReactiveVar(null);
});

Template.companyUsersInvite.helpers({
  nameError: function () {
    return Template.instance().nameError.get();
  },
  nameErrorClass: function () {
    return Template.instance().nameError.get() ? 'has-error' : '';
  },
  nameInvalid: function () {
    return Template.instance().nameError.get() ? 'true' : 'false';
  }
});

Template.companyUsersInvite.events({
  'submit .invite': function (event, instance) {
    event.preventDefault();
    const nameProblem = userNameProblem($(event.target).find('[name=name]').val());
    if (nameProblem) {
      // Same check and message as the Profile form; the schema alone gave a
      // generic error for a bad name and let a whitespace-only one through.
      instance.nameError.set(USER_NAME_MESSAGES[nameProblem]);
      $(event.target).find('[name=name]').trigger('focus');
      return;
    }
    instance.nameError.set(null);
    const name = normalizeUserName($(event.target).find('[name=name]').val());
    const email = $(event.target).find('[name=email]').val();
    if (email) {
      try {
        UserSchema.validate({
          profile: {
            name: name,
            email: email
          }
        });
        Meteor.callAsync('inviteUser', name, email).then(function(response) {
          if (response && response.error) {
            Notify.danger(response.error);
          } else {
            // Re-subscribe to pick up the newly invited user
            Meteor.subscribe('companyUsers');
            $('select.select2:visible').select2({width: '100%'});
            Notify.success('User invited:' + name);
            event.target.reset();
          }
        }).catch(function(error) {
          Notify.danger(error.reason || error.message || 'Invitation failed');
        });
      } catch (error) {
        Notify.danger(error.reason || error.message || 'Validation error');
      }
    } else {
      Notify.warn('Please enter Name and E-Mail');
    }
  }
});
