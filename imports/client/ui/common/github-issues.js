import {Template} from 'meteor/templating';
import {Meteor} from 'meteor/meteor';
import {Blaze} from 'meteor/blaze';
import {Session} from 'meteor/session';
import _ from 'underscore';
import {$} from 'meteor/jquery';
import Projects from '/imports/lib/collections/projects';
import Notify from '/imports/api/notify';
import Utils from '/imports/lib/utils';
import gh from 'parse-github-url';

Template.githubIssuesLink.onCreated(function () {
  const Company = Session.get('company');
  let project = {};
  if (this.data.module) {
    project = Projects.findOne({_id: this.data.module.projectId});
  }
   
  const module = Blaze.getData($('.ecs-licenses,.ecs-dependencies-box')[0]);
  if (Company && Company.github && Company.github.active && module) {
    const template = Template.instance();
    Session.set('github', Company.github.active);
    Session.set('githubKey', Company.github.key);
    if (template.data && template.data.github && template.data.github.github) {
      Meteor.callAsync(
        'tsGithubGetIssue',
        project && project._id,
        module.urls && module.urls.repository,
        template.data.github.github
      ).then(function(result) {
        Session.set('githubTaskStatus' + template.data.github.github, result.data && result.data.state);
      }).catch(function(error) {
        console.error('tsGithubGetIssue failed:', error);
      })
    }
  } else {
    Session.set('github');
  }
  if (project && project.github && project.github.active) {
    const settings = Company && _.extend(Company.github, Utils.removeEmpty(_(project.github).clone()));
    const template = Template.instance();
    Session.set('github', settings && settings.active);
    Session.set('githubKey',  settings && settings.key);
    if (template.data && template.data.github && template.data.github.github) {
      Meteor.callAsync(
        'tsGithubGetIssue',
        project._id,
        module.urls && module.urls.repository,
        template.data.github.github
      ).then(function(result) {
        Session.set('githubTaskStatus' + template.data.github.github, result.data && result.data.state);
      }).catch(function(error) {
        console.error('tsGithubGetIssue failed:', error);
      })
    }
  }
  Session.set('githubApp')
  if(module && module.urls && module.urls.repository){
    const data = gh(module.urls.repository)
    Session.set('githubApp', `https://github.com/${data.owner}/${data.name}/issues/`)
  }
});

Template.githubIssuesLink.helpers({
  github: function () {
    return Session.get('github');
  },
  githubApp: function () {
    return Session.get('githubApp');
  },
  githubId: function () {
    return this.github && this.github.github;
  },
  isEmailed: function () {
    return this.github && this.github.github === 'EMAILED';
  },
  noGithub: function () {
    return !Session.get('github');
  },
  githubTaskStatus: function () {
    return Session.get('githubTaskStatus' + this.github.github) || 'Issue created'
  },
  isType: function (type) {
    return Session.get('githubType') === type;
  }
});

let _ghIssueData = null;

function ghIssueSubmitHandler(form) {
  const data = _ghIssueData;
  if (!data) return;
  const item = (data.details._id) ? data.details : data.details.data();
  const module = Blaze.getData($('.ecs-dependencies-box, .ecs-licenses')[0]);
  const modalTitle = $(form).find('[name=modalTitle]').val();
  const modalDescription = $(form).find('[name=modalDescription]').val();
  if (!(module.urls && module.urls.repository)) {
    Notify.warn('Repo url is not found in module settings');
  } else {
    Meteor.callAsync(
      'tsGithubCreateIssue',
      module.projectId,
      module.urls && module.urls.repository,
      modalTitle,
      modalDescription
    ).then(function(result) {
      if (result.data && !result.response) {
        const module = Blaze.getData($('.ecs-licenses,.ecs-dependencies-box')[0]);
        const arr = module.getGithubIntegrations();
        const originalData = _.clone(arr);
        arr.push({github: result.data.number, ecs: item.key});
        Meteor.callAsync('updateCollection', 'Modules', module._id, 'github', arr, false, originalData);
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

Template.githubIssuesLink.events({
  'click .show-github-modal': function (event) {
    _ghIssueData = this;
    const modal = $(event.currentTarget).siblings('.createIssue');
    modal.find('[name=modalTitle]').val((Session.get('githubKey') ? '[' + Session.get('githubKey') + '] ' : '') + this.description.title);
    modal.find('[name=modalDescription]').val(this.description.text);
    modal.modal('show');
    modal.off('shown.bs.modal.ghInit').on('shown.bs.modal.ghInit', function () {
      let form = $(this).find('.createIssueForm');
      if (form.length) {
        form.validate({
          submitHandler: ghIssueSubmitHandler
        });
      }
    });
  },
  'click .remove-github': function () {
    const item = this;
    const component = this.details._id ? this.details : this.details.data();
    const project = Projects.findOne({_id: this.module.projectId});
    const module = Blaze.getData($('.ecs-licenses,.ecs-dependencies-box')[0]);
    Meteor.callAsync(
      'tsGithubRemoveIssue',
      project._id,
      module.urls && module.urls.repository,
      item.github.github
    ).then(function(result) {
      if (result.status !== 404 || !result.response.data.message) {
        processRemoveIssue(component)
      } else {
        Notify.danger(result.response.data.message)
      }
    }).catch(function(error) {
      Notify.danger(error.reason || error.message || 'Could not remove GitHub issue');
    });
  }
});

function processRemoveIssue(item) {
  const module = Blaze.getData($('.ecs-licenses,.ecs-dependencies-box')[0]);
  const arr = module.getGithubIntegrations();
  const originalData = _.clone(arr);
  const filteredArr = _.reject(arr, function (e) {
    return e.ecs === item.key;
  });
  if (arr.length !== filteredArr.length) {
    Meteor.callAsync('updateCollection', 'Modules', module._id, 'github', filteredArr, false, originalData);
  }
  Notify.success('Issue was successfully removed');
}
