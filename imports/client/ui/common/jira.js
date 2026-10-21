import {Template} from 'meteor/templating';
import {Meteor} from 'meteor/meteor';
import {Blaze} from 'meteor/blaze';
import {Session} from 'meteor/session';
import _ from 'underscore';
import {$} from 'meteor/jquery';
import Projects from '/imports/lib/collections/projects';
import Notify from '/imports/api/notify';
import Utils from '/imports/lib/utils';

Template.jiraLink.onCreated(function () {
  const Company = Session.get('company');
  let project = {};
  if (this.data.module) {
    project = Projects.findOne({_id: this.data.module.projectId});
  }
  if (Company && Company.jira && Company.jira.active) {
    const template = Template.instance();
    Session.set('jira', Company.jira.active);
    Session.set('jiraApp', Company.jira.url);
    Session.set('jiraKey', Company.jira.key);
    Session.set('jiraType', Company.jira.type);
    Session.set('jiraEmail', Company.jira.email);
    if (template.data && template.data.jira && template.data.jira.jira) {
      Meteor.callAsync('jiraGetIssue', template.data.jira.jira, project && project._id).then(function(result) {
        Session.set('jiraTaskStatus' + template.data.jira.jira, result.data && result.data.fields.status.name);
      }).catch(function(error) {
        console.error('jiraGetIssue failed:', error);
      })
    }
  } else {
    Session.set('jira');
  }
  if (project && project.jira && project.jira.active) {
    const settings = _.extend(Company.jira, Utils.removeEmpty(_(project.jira).clone()));
    const template = Template.instance();
    Session.set('jira', settings.active);
    Session.set('jiraApp', settings.url);
    Session.set('jiraKey', settings.key);
    Session.set('jiraType', settings.type);
    Session.set('jiraEmail', settings.email);
    if (template.data && template.data.jira && template.data.jira.jira && Session.get('jiraType') !== 'email') {
      Meteor.callAsync('jiraGetIssue', template.data.jira.jira, project._id).then(function(result) {
        Session.set('jiraTaskStatus' + template.data.jira.jira, result.data && result.data.fields.status.name);
      }).catch(function(error) {
        console.error('jiraGetIssue failed:', error);
      })
    }
  }
});

Template.jiraLink.helpers({
  jira: function () {
    return Session.get('jira');
  },
  jiraApp: function () {
    return Session.get('jiraApp');
  },
  jiraId: function () {
    return this.jira && this.jira.jira;
  },
  isEmailed: function () {
    return this.jira && this.jira.jira === 'EMAILED';
  },
  noJira: function () {
    return !Session.get('jira');
  },
  jiraTaskStatus: function () {
    return Session.get('jiraTaskStatus' + this.jira.jira) || 'Issue created'
  },
  isType: function (type) {
    return Session.get('jiraType') === type;
  }
});

let _jiraIssueData = null;

function jiraIssueSubmitHandler(form) {
  const self = _jiraIssueData;
  if (!self) return;
  const item = (self.details._id) ? self.details : self.details.data();
  const project = Projects.findOne({_id: self.module.projectId});
  const data = {
    'fields': {
      'project': {
        'key': Session.get('jiraKey')
      },
      'summary': $(form).find('[name=modalTitle]').val(),
      'description': $(form).find('[name=modalDescription]').val(),
      'labels': ['trustsource_issue'],
      'issuetype': {
        'id': '1'
      }
    }
  };
  Meteor.callAsync('jiraCreateIssue', data, project && project._id).catch(function(error) {
    Notify.danger(error.reason || error.message || 'Could not create Jira issue');
  }).then(function(result) {
    if (!result) return;
    if (result.data && !result.data.errorMessages) {
      const module = Blaze.getData($('.ecs-licenses,.ecs-dependencies-box')[0]);
      const arr = module.getJiraIntegrations();
      const originalData = _.clone(arr);
      arr.push({jira: result.data.key, ecs: item.key});
      Meteor.callAsync('updateCollection', 'Modules', module._id, 'jira', arr, false, originalData);
      Notify.success('Issue was successfully created');
    } else {
      if (result && result.statusCode === 401) {
        Notify.danger('The request has not been applied because it lacks valid ' +
          'authentication credentials for the target resource. Please check you Jira authorization.')
      } else if (result && result.data) {
        Notify.danger(result.data.errorMessages.join('; '))
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

Template.jiraLink.events({
  'click .show-jira-modal': function (event) {
    _jiraIssueData = this;
    const modal = $(event.currentTarget).siblings('.createIssue');
    modal.find('[name=modalTitle]').val((Session.get('jiraKey') ? '[' + Session.get('jiraKey') + '] ' : '') + this.description.title);
    modal.find('[name=modalDescription]').val(this.description.text);
    modal.modal('show');
    modal.off('shown.bs.modal.jiraInit').on('shown.bs.modal.jiraInit', function () {
      let form = $(this).find('.createIssueForm');
      if (form.length) {
        form.validate({
          submitHandler: jiraIssueSubmitHandler
        });
      }
    });
  },
  'click .remove-jira': function () {
    const item = this.details._id ? this.details : this.details.data();
    const project = Projects.findOne({_id: this.module.projectId});
    if(Session.get('jiraType') !== 'email'){
      Meteor.callAsync('jiraRemoveIssue', this.jira.jira, project && project._id).then(function(result) {
        if (result.statusCode === 404 || !result.data.errorMessages) {
          processRemoveIssue(item)
        } else {
          Notify.danger(result.data.errorMessages.join('; '))
        }
      }).catch(function(error) {
        Notify.danger(error.reason || error.message || 'Could not remove Jira issue');
      });
    }else {
      processRemoveIssue(item)
    }
  }
});

function processRemoveIssue(item) {
  const module = Blaze.getData($('.ecs-components,.ecs-licenses')[0]);
  const arr = module.getJiraIntegrations();
  const originalData = _.clone(arr);
  const filteredArr = _.reject(arr, function (e) {
    return e.ecs === item.key;
  });
  if (arr.length !== filteredArr.length) {
    Meteor.callAsync('updateCollection', 'Modules', module._id, 'jira', filteredArr, false, originalData);
  }
  Notify.success('Issue was successfully removed');
}
