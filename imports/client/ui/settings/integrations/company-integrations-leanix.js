import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {$} from 'meteor/jquery';
import Notify from '/imports/api/notify';

Template.companyIntegrationsLeanix.events({
  'submit .leanix': function (event) {
    event.preventDefault();
    let company = this;
    //const workspace = $(event.target).find('[name=workspace]').val();
    //const user = $(event.target).find('[name=user]').val();
    const token = $(event.target).find('[name=token]').val();
    const companyName = $(event.target).find('[name=companyName]').val();
    Meteor.callAsync('Companies.UpdateLeanix', company._id, {'leanix.companyName': companyName, 'leanix.token': token}).then(() => {
      const user = Meteor.user();
      Meteor.callAsync('logEvent', user, 'Company '+company.name+' Leanix settings changed', 'leanIxSettingsUpdated');
      Notify.success('Company changed');
    }).catch((error) => {
      const user = Meteor.user();
      Meteor.callAsync('logEvent', user, 'Error: '+error.message, 'leanIxSettingsUpdated');
      Notify.danger(error.message);
    });
  }
});
