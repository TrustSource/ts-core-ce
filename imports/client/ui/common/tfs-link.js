import {Template} from 'meteor/templating';
import {Meteor} from 'meteor/meteor';
import {Blaze} from 'meteor/blaze';
import {Session} from 'meteor/session';
import _ from 'underscore';
import {$} from 'meteor/jquery';
import Notify from '/imports/api/notify';

const TFS_TASK = 'tfsTaskStatus.';

Template.tfsLink.onCreated(function () {
  const projectId = this.data.module.projectId;
  const template = Template.instance();
  const tfsId = template.data && template.data.tfs && template.data.tfs.id;
  Meteor.callAsync('Projects.GetTfsCredentials.exists?', projectId).then(function(result2) {
    Session.set('possibleTfs', result2);
  }).catch(function(error) {
    console.log(error);
    return Session.set('possibleTfs');
  });
  if (tfsId) {
    Meteor.callAsync('tfs.workItems.get', projectId, tfsId).then(function(result) {
      Session.set(TFS_TASK + tfsId, result && result.fields['System.State']);
    }).catch(function(error) {
      console.error('tfs.workItems.get failed:', error);
    })
  }
});

Template.tfsLink.helpers({
  tfsId: function () {
    return this.tfs && this.tfs.id;
  },
  noTfs: function () {
    return !Session.get('possibleTfs');
  },
  tfsTaskStatus: function () {
    const tfsId = this.tfs && this.tfs.id;
    return (tfsId && Session.get(TFS_TASK + tfsId)) || 'View issue'
  }
});

let _tfsIssueData = null;

function tfsIssueSubmitHandler(form) {
  const self = _tfsIssueData;
  if (!self) return;
  const item = (self.details._id) ? self.details : self.details.data();
  const data = {
    Title: $(form).find('[name=modalTitle]').val(),
    ReproSteps: $(form).find('[name=modalDescription]').val(),
    Tag: 'trustsource_issue'
  };
  const projectId = self.module.projectId;
  Meteor.callAsync('tfs.workItems.create', projectId, 'Bug', data).then(function(result) {
    if (result) {
      const module = Blaze.getData($('.ecs-components,.ecs-licenses')[0]);
      const arr = module.getTfsIntegrations();
      const originalData = _.clone(arr);
      arr.push({id: result.id, ecs: item.key});
      Meteor.callAsync('updateCollection', 'Modules', module._id, 'tfs', arr, false, originalData);
      Session.set(TFS_TASK + result.id, result.fields['System.State']);
      Notify.success('Issue was successfully created');
    }
  }).catch(function(error) {
    Notify.danger(error.message);
  }).finally(function() {
    Meteor.setTimeout(function () {
      $('.createIssue').modal('hide');
      $('.modal-backdrop.fade').remove();
      $('body').removeClass('modal-open').css({'padding-right': 0});
    }, 200);
  });
}

Template.tfsLink.events({
  'click .show-tfs-modal': function (event) {
    _tfsIssueData = this;
    const modal = $(event.currentTarget).siblings('.createIssue');
    modal.find('[name=modalTitle]').val(this.description.title);
    modal.find('[name=modalDescription]').val(this.description.text);
    modal.modal('show');
    modal.off('shown.bs.modal.tfsInit').on('shown.bs.modal.tfsInit', function () {
      let form = $(this).find('.createIssueForm');
      if (form.length) {
        form.validate({
          submitHandler: tfsIssueSubmitHandler
        });
      }
    });
  },
  'click .remove-tfs': function (event) {
    event.preventDefault();
    const item = this.details._id ? this.details : this.details.data();
    const tfsId = this.tfs.id;
    Meteor.callAsync('tfs.workItems.delete', this.module.projectId, tfsId).then(function() {
      const module = Blaze.getData($('.ecs-components,.ecs-licenses')[0]);
      const arr = module.getTfsIntegrations();
      const originalData = _.clone(arr);
      const filteredArr = _.reject(arr, function (e) {
        return e.ecs === item.key;
      });
      if (arr.length !== filteredArr.length) {
        Meteor.callAsync('updateCollection', 'Modules', module._id, 'tfs', filteredArr, false, originalData);
      }
      Session.set(TFS_TASK + tfsId);
      Notify.success('Issue was successfully removed');
    }).catch(function(error) {
      Notify.danger(error.message);
    });
  }
});
