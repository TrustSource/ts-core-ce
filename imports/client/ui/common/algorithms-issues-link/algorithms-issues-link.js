import {Template} from 'meteor/templating';
import {Meteor} from 'meteor/meteor';
import {Session} from 'meteor/session';
import {$} from 'meteor/jquery';
import Clipboard from 'clipboard';
import Notify from '/imports/api/notify';

let _algIssueData = null;

function algIssueSubmitHandler(form) {
  const modalTitle = $(form).find('[name=modalTitle]').val();
  const modalDescription = $(form).find('[name=modalDescription]').val();
  const self = _algIssueData;
  if (!self || !self.repository) {
    Notify.warn('Repo url is not found in company / project / module settings');
    return;
  }
  Meteor.callAsync(
    'tsGithubCreateIssue',
    self.projectId,
    self.repository,
    modalTitle,
    modalDescription
  ).then(function(result) {
    if (result.data && !result.response) {
      Notify.success('Issue was successfully created');
    } else {
      if (result && result.status === 401) {
        Notify.danger('The request has not been applied because it lacks valid ' +
          'authentication credentials for the target resource. Please check you GitHub issues authorization.')
      } else if (result && result.response && result.response.data) {
        Notify.danger(result.response.data.message)
      } else {
        Notify.danger('Internal error. Please contact support')
      }
    }
  }).catch(function(error) {
    Notify.danger(error.reason || error.message || 'Could not create GitHub issue');
  }).finally(function() {
    Meteor.setTimeout(function () {
      $('.createIssue').modal('hide');
      $('.modal-backdrop.fade').remove();
      $('body').removeClass('modal-open').css({'padding-right': 0});
    }, 200);
  });
}

Template.algorithmsIssuesLink.onCreated(function () {
  let clipboard = new Clipboard('.copy-information');

  clipboard.on('success', function (e) {
    Notify.success('Information was successfully copied');
    e.clearSelection();
  });
});

Template.algorithmsIssuesLink.helpers({
  noGithub: function () {
    return !this.repository;
  }
});

Template.algorithmsIssuesLink.events({
  'click .show-github-modal': function (event) {
    _algIssueData = this;
    const modal = $(event.currentTarget).siblings('.createIssue');
    modal.find('[name=modalTitle]').val((Session.get('githubKey') ? '[' + Session.get('githubKey') + '] ' : '') + this.description.title);
    modal.find('[name=modalDescription]').val(this.description.text);
    modal.modal('show');
    modal.off('shown.bs.modal.algInit').on('shown.bs.modal.algInit', function () {
      let form = $(this).find('.createIssueForm');
      if (form.length) {
        form.validate({
          submitHandler: algIssueSubmitHandler
        });
      }
    });
  }
});

$(document).on('hidden.bs.modal', '.createIssue', function () {
  _algIssueData = null;
});
