import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {$} from 'meteor/jquery';
import Notify from '/imports/api/notify';

Template.projectSettingsJira.events({
  'click .jira-project .btn': function (event) {
    event.preventDefault();
    let parent = Template.parentData();
    let current = Template.currentData();
    let project = current && current.moduleCount ? current : parent
    let jira = {
      url: $(event.target).parents('form').find('[name=jira-url]').val(),
      user: $(event.target).parents('form').find('[name=jira-user]').val(),
      passwd: $(event.target).parents('form').find('[name=jira-passwd]').val(),
      key: $(event.target).parents('form').find('[name=jira-key]').val(),
      email: $(event.target).parents('form').find('[name=jira-email]').val()
    };
    jira.active = !!$(event.target).parents('form').find('[name=jira-active]:checked').length;
    jira.type = $(event.target).parents('form').find('[name=jira-type]:checked').length ? 'email' : 'api';
    Meteor.callAsync('Projects.UpdateJira', project._id, jira).then(function() {
      Notify.success('Company changed');
    }).catch(function(error) {
      Notify.danger(error.message);
    });
  },
  'change #jira-type': function (event) {
    event.preventDefault();
    let parent = Template.parentData();
    let current = Template.currentData();
    let project = current && current.moduleCount ? current : parent
    const type = (!project.jira || project.jira && project.jira.type === 'api') ? 'email' : 'api'
    Meteor.callAsync('Projects.UpdateJira', project._id, {type}).then(function() {
      Notify.success('Jira type changed');
    }).catch(function(error) {
      Notify.danger(error.message);
    });
  }
});

Template.projectSettingsJira.helpers({
  currentProject: function () {
    let parent = Template.parentData();
    let current = Template.currentData();
    return current && current.moduleCount ? current : parent
  },
  isMultyJiraUnavailable: function () {
    let current = Template.currentData();
    return current.disabled;
  },
  isType: function (type) {
    let parent = Template.parentData();
    let current = Template.currentData();
    let project = current && current.moduleCount ? current : parent
    let settings = project.jira && project.jira.type
    return settings === type;
  }
});
