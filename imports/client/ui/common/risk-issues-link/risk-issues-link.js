import {Template} from 'meteor/templating';
import {Meteor} from 'meteor/meteor';
import {Session} from 'meteor/session';
import {$} from 'meteor/jquery';
import Clipboard from 'clipboard';
import Notify from '/imports/api/notify';

Template.riskIssuesLink.onCreated(function () {
  let clipboard = new Clipboard('.copy-information');

  clipboard.on('success', function (e) {
    Notify.success('Information was successfully copied');
    e.clearSelection();
  });
});

Template.riskIssuesLink.helpers({
  noGithub: function () {
    return !this.repository;
  }
});

function getData() {
  Meteor.callAsync('Tasks.Find', {riskId: Session.get('editRiskDetails')}).then(function(result) {
    Session.set('riskEditTaskList', result);
  }).catch(function(error) {
    console.error('Tasks.Find failed:', error);
  })
}

let _riskIssueData = null;

function riskIssueSubmitHandler(form) {
  const self = _riskIssueData;
  if (!self) return;
  const modalTitle = $(form).find('[name=modalTitle]').val();
  const modalDescription = $(form).find('[name=modalDescription]').val();
  if (!self.repository) {
    Notify.warn('Repo url is not found in company / project / module settings');
  } else {
    Meteor.callAsync(
      'tsGithubCreateIssue',
      self.projectId,
      self.repository,
      modalTitle,
      modalDescription
    ).then(function(result) {
      if (result.data && !result.response) {
        if (result.data.html_url) {
          Meteor.callAsync('Tasks.Update', self.taskId, null, {$set: {githubLink: result.data.html_url}}).catch(function() {});
          getData();
        }
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
    }).finally(function() {
      Meteor.setTimeout(function () {
        $('.createIssue').modal('hide');
        $('.modal-backdrop.fade').remove();
        $('body').removeClass('modal-open').css({'padding-right': 0});
      }, 200);
    });
  }
}

Template.riskIssuesLink.events({
  'click .show-github-modal': function (event) {
    _riskIssueData = this;
    const modal = $(event.currentTarget).siblings('.createIssue');
    modal.find('[name=modalTitle]').val((Session.get('githubKey') ? '[' + Session.get('githubKey') + '] ' : '') + this.description.title);
    modal.find('[name=modalDescription]').val(this.description.text);
    modal.modal('show');
    modal.off('shown.bs.modal.riskInit').on('shown.bs.modal.riskInit', function () {
      let form = $(this).find('.createIssueForm');
      if (form.length) {
        form.validate({
          submitHandler: riskIssueSubmitHandler
        });
      }
    });
  },
  'click .remove-github': function () {
    const self = this;
    Meteor.callAsync('Tasks.Update', self.taskId, null, {$unset: {githubLink: 1}}, null).then(function() {
      getData()
    }).catch(function(error) {
      Notify.danger(error.reason || error.message || 'Could not update task');
    });
  }
});
