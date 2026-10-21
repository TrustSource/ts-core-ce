import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {$} from 'meteor/jquery';
import Notify from '/imports/api/notify';
import collectionUrl from '/imports/lib/tfs/collectionUrl';

Template.projectSettingsGithub.events({
  'click .github-project .btn': function (event) {
    event.preventDefault();
    let github = {};
    let parent = Template.parentData();
    let current = Template.currentData();
    let project = current && current.moduleCount ? current : parent
    let $form = $(event.target).parents('form');
    github.token = $form.find('[name=github-token]').val();
    github.repository = $form.find('[name=github-repository]').val();
    github.active = $form.find('[name=github-active]').prop('checked');
    Meteor.callAsync('Projects.UpdateGithub', project._id, github).then(function() {
      Notify.success('Project changed');
      $('.github-account-result').html('');
    }).catch(function(error) {
      Notify.danger(error.message);
    });
  }
});

Template.projectSettingsGithub.helpers({
  currentProject: function () {
    let parent = Template.parentData();
    let current = Template.currentData();
    return current && current.moduleCount ? current : parent
  },
  isMultyGithubUnavailable: function () {
    let current = Template.currentData();
    return current.disabled;
  },
  githubAccountResult: function () {
    let parent = Template.parentData();
    let current = Template.currentData();
    let project = current && current.moduleCount ? current : parent
    return collectionUrl(project.github && project.github.account);
  }
});
