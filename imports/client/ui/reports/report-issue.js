/* global Promise:false */
import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {$} from 'meteor/jquery';
import _ from 'underscore';
import {Session} from 'meteor/session';
import Projects from '/imports/lib/collections/projects';

function initProjectList() {
  let result = Projects.findMapped();
  if (!Session.get('reportProject') || !_.any(result, function (item) {return item._id === Session.get('reportProject')})) {
    Session.set('reportProject', result[0] && result[0]._id);
  }
  Session.set('companyProjects', result);
}

function checkIntegration() {
  Session.set('issueManager');
  Promise.all([
    // Jira
    new Promise((resolve, reject) =>
      Meteor.callAsync('Projects.GetJiraCredentials.exists?', Session.get('reportProject')).then(function(result2) {
        Session.set('possibleJira', result2);
        resolve(result2);
      }).catch(function(error) {
        console.log(error);
        Session.set('possibleJira');
        reject(error);
      })
    ),
    // TFS
    new Promise((resolve, reject) =>
      Meteor.callAsync('Projects.GetTfsCredentials.exists?', Session.get('reportProject')).then(function(result2) {
        Session.set('possibleTfs', result2);
        resolve(result2);
      }).catch(function(error) {
        console.log(error);
        Session.set('possibleTfs');
        reject(error);
      })
    ),
    // GitHub
    new Promise((resolve, reject) =>
      Meteor.callAsync('Projects.GetGithubCredentials.exists?', Session.get('reportProject')).then(function(result2) {
        Session.set('possibleGithub', result2);
        resolve(result2);
      }).catch(function(error) {
        console.log(error);
        Session.set('possibleGithub');
        reject(error);
      })
    )
  ]).then(([jira, tfs, github]) => {
    if (jira) {
      Session.set('issueManager', 'jira');
    } else if(tfs) {
      Session.set('issueManager', 'tfs');
    } else if(github) {
      Session.set('issueManager', 'github');
    } else {
      Session.set('issueManager', 'no');
    }
  });
}

Template.reportIssue.onRendered(function () {
  checkIntegration();
  this.autorun(function () {
    initProjectList();
    Meteor.setTimeout(function () {
      $('.select2').select2({width: '100%'});
    }, 1);
  });
});
Template.reportIssue.events = {
  'change .current-project': function (event) {
    Session.set('reportProject', $(event.target).val());
    checkIntegration();
  },
  'change #issueManager': function (event) {
    event.preventDefault();
    let newVal = $(event.target).val();
    Session.set('issueManager', newVal);
  }
};
Template.reportIssue.helpers({
  getProject: function () {
    return Session.get('reportProject');
  },
  projectList: function () {
    return Session.get('companyProjects');
  },
  isActiveProject: function () {
    return Session.get('reportProject') === this._id
  },
  isChecked: function (value) {
    return Session.get('issueManager') === value;
  },
  getProjectName: function () {
    let projects = Session.get('companyProjects');
    let current = Session.get('reportProject');
    return current && projects && _.find(projects, function (item) {
      return item._id === current
    }).name
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
  issueManagerNotConfigured: function () {
    return Session.get('issueManager') === 'no';
  },
  issueManagerChecked: function () {
    return Session.get('issueManager') === 'jira' ? 'checked' : '';
  },
  jiraAvailable: function () {
    return Session.get('possibleJira');
  },
  tfsAvailable: function () {
    return Session.get('possibleTfs');
  },
  githubAvailable: function () {
    return Session.get('possibleGithub');
  },
  issueManagers: function () {
    return Session.get('possibleJira') && Session.get('possibleTfs') && Session.get('possibleGithub');
  }
});
