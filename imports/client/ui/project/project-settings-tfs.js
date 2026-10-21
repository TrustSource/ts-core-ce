import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {$} from 'meteor/jquery';
import Notify from '/imports/api/notify';
import collectionUrl from '/imports/lib/tfs/collectionUrl';

Template.projectSettingsTfs.events({
  'click .tfs-project .btn': function (event) {
    event.preventDefault();
    let tfs = {};
    let parent = Template.parentData();
    let current = Template.currentData();
    let project = current && current.moduleCount ? current : parent
    let $form = $(event.target).parents('form');
    tfs.account = $form.find('[name=tfs-account]').val();
    tfs.project = $form.find('[name=tfs-project]').val();
    tfs.token = $form.find('[name=tfs-token]').val();
    tfs.active = $form.find('[name=tfs-active]').prop('checked');
    Meteor.callAsync('Projects.UpdateTfs', project._id, tfs).then(function() {
      Notify.success('Project changed');
      $('.tfs-account-result').html('');
    }).catch(function(error) {
      Notify.danger(error.message);
    });
  },
  'keyup #tfs-account': function (event) {
    $('.tfs-account-result').html(collectionUrl(event.target.value));
  }
});

Template.projectSettingsTfs.helpers({
  currentProject: function () {
    let parent = Template.parentData();
    let current = Template.currentData();
    return current && current.moduleCount ? current : parent
  },
  isMultyTfsUnavailable: function () {
    let current = Template.currentData();
    return current.disabled;
  },
  tfsAccountResult: function () {
    let parent = Template.parentData();
    let current = Template.currentData();
    let project = current && current.moduleCount ? current : parent
    return collectionUrl(project && project.tfs && project.tfs.account);
  }
});
