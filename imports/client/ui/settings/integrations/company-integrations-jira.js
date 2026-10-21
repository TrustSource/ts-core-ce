import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {$} from 'meteor/jquery';
import Notify from '/imports/api/notify';

Template.companyIntegrationsJira.onRendered(function () {
  Meteor.setTimeout(function () {
    $('.i-checks').iCheck({
      checkboxClass: 'icheckbox_square-green',
      radioClass: 'iradio_square-green'
    });
  },1);
});
Template.companyIntegrationsJira.events({
  'submit .jira': function (event) {
    event.preventDefault();
    let jira = {};
    let company = this;
    jira.url = $(event.target).find('[name=jira-url]').val();
    jira.user = $(event.target).find('[name=jira-user]').val();
    jira.passwd = $(event.target).find('[name=jira-passwd]').val();
    jira.key = $(event.target).find('[name=jira-key]').val();
    jira.email = $(event.target).parents('form').find('[name=jira-email]').val();
    jira.active = !!$(event.target).find('[name=jira-active]:checked').length;
    jira.type = $(event.target).parents('form').find('[name=jira-type]:checked').length ? 'email' : 'api';
    Meteor.callAsync('Companies.UpdateJira', jira).then(function() {
      const user = Meteor.user();
      Meteor.callAsync('logEvent', user, 'Company '+company.name+' Jira settings changed', 'jiraSettingsUpdated');
      Notify.success('Company changed');
    }).catch(function(error) {
      const user = Meteor.user();
      Meteor.callAsync('logEvent', user, error.message, 'jiraSettingsUpdated');
      Notify.danger(error.message);
    });
  },
  'change #jira-type': function (event) {
    event.preventDefault();
    const type = (!this.jira || this.jira && this.jira.type === 'api') ? 'email' : 'api'
    Meteor.callAsync('Companies.UpdateJira', {type}).then(function() {
      Notify.success('Jira type changed');
    }).catch(function(error) {
      Notify.danger(error.message);
    });
  }
});
Template.companyIntegrationsJira.helpers({
  isType: function (type) {
    let current = this.jira && this.jira.type
    return current === type;
  }
});
