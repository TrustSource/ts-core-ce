import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {$} from 'meteor/jquery';
import Notify from '/imports/api/notify';

Template.companyIntegrationsGithub.onRendered(function () {
  Meteor.setTimeout(function () {
    $('.i-checks').iCheck({
      checkboxClass: 'icheckbox_square-green',
      radioClass: 'iradio_square-green'
    });
  },1);
});
Template.companyIntegrationsGithub.events({
  'submit .github': function (event) {
    event.preventDefault();
    let company = this;
    let github = {
      token: $(event.target).find('[name=github-token]').val(),
      repository: $(event.target).find('[name=github-repository]').val(),
      active: $(event.target).find('[name=github-active]').prop('checked')
    };
    Meteor.callAsync('Companies.UpdateGithub', github).then(function() {
      const user = Meteor.user();
      Meteor.callAsync('logEvent', user, 'Company '+company.name+' GitHub settings changed', 'githubSettingsUpdated');
      Notify.success('Company changed');
    }).catch(function(error) {
      const user = Meteor.user();
      Meteor.callAsync('logEvent', user, 'Error: '+error.message, 'githubSettingsUpdated');
      Notify.danger(error.message);
    });
  }
});
