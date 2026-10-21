import {Template} from 'meteor/templating';
import {Session} from 'meteor/session';
import {$} from 'meteor/jquery';

Template.projectSettingsIssue.onCreated(function () {
  let currentManager = 'tfs'
  let project = this.data
  if(project && project.jira && project.jira.active){
    currentManager = 'jira'
  }
  if(project && project.github && project.github.active){
    currentManager = 'github'
  }
  Session.set('issueManager', currentManager);
});
Template.projectSettingsIssue.onRendered(function () {
  $('.select2').select2({width: '100%'}).val(Session.get('issueManager')).trigger('change').on('change.select2', function () {
    let values = $('[name=issueManager]').select2('data');
    Session.set('issueManager', values && values[0] && values[0].id);
  });
});

Template.projectSettingsIssue.events({
  'change #issueManager': function (event) {
    event.preventDefault();
    let newVal = $(event.target).val();
    Session.set('issueManager', newVal);
  }
});

Template.projectSettingsIssue.helpers({
  currentProject: function () {
    let parent = Template.parentData();
    let current = Template.currentData();
    return current && current.moduleCount ? current : parent
  },
  issueManagerJira: function () {
    return Session.get('issueManager') === 'jira';
  },
  issueManagerTfs: function () {
    return Session.get('issueManager') === 'tfs';
  },
  issueManagerGithub: function () {
    return Session.get('issueManager') === 'github';
  },
  isChecked: function (value) {
    return Session.get('issueManager') === value ? 'checked': null;
  }
});
