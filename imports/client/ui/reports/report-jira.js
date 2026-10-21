import {Template} from 'meteor/templating';
import {$} from 'meteor/jquery';
import _ from 'underscore';
import {Session} from 'meteor/session';
import {ReactiveMethod} from '/imports/lib/reactiveMethod';
import {moment} from 'meteor/momentjs:moment';
import Projects from '/imports/lib/collections/projects';
import Utils from '/imports/lib/utils';

function initProjectSettings(project,Company){
  if (project && project.jira && project.jira.active) {
    const settings = _.extend(Company.jira, Utils.removeEmpty(_(project.jira).clone()));
    Session.set('jira', settings.active);
    Session.set('jiraApp', settings.url);
    Session.set('jiraKey', settings.key);
  }else{
    Session.set('jira', Company.jira.active);
    Session.set('jiraApp', Company.jira.url);
    Session.set('jiraKey', Company.jira.key);
  }
}

Template.reportJira.onRendered(function () {
  const Company = Session.get('company');
  if (Company && Company.jira && Company.jira.active) {
    Session.set('jira', Company.jira.active);
    Session.set('jiraApp', Company.jira.url);
    Session.set('jiraKey', Company.jira.key);
  } else {
    Session.set('jira');
  }
  const routerProjectId = Session.get('reportProject');
  if(routerProjectId){
    Session.set('reportProject',routerProjectId);
    const Project = Projects.findOne(routerProjectId);
    initProjectSettings(Project,Company)
  }
});
Template.reportJira.events = {
  'change .current-project': function (event) {
    const routerProjectId = $(event.target).val();
    const Project = Projects.findOne(routerProjectId);
    const Company = Session.get('company');
    initProjectSettings(Project,Company);
    Session.set('reportProject', routerProjectId);
  }
};
Template.reportJira.helpers({
  jiraApp: function () {
    return Session.get('jiraApp');
  },
  getCreatedDate: function () {
    return moment(this.fields.created).format('lll')
  },
  getProjectJiraTasks: function () {
    Session.set('requestInProgress', true);
    let getList = ReactiveMethod.call('jiraGetIssueList',Session.get('reportProject'),Session.get('jiraKey'));
    Session.set('reportProjectJiraIssues', getList && getList.data && getList.data.issues);
    if(getList){
      Session.set('requestInProgress', false);
      return getList.data && getList.data.issues
    }else{
      return []
    }
  },
  getProjectJiraTasksStatus: function () {
    return Session.get('reportProjectJiraIssues');
  },
  getStatusStats: function () {
    let statuses = _.groupBy(_.map(Session.get('reportProjectJiraIssues'),function (issue) {
      return issue.fields.status
    }),'name');
    statuses = _.sortBy(_.map(statuses,function (list,key) {
      return {
        key:key,
        color:list[0].statusCategory.colorName,
        order:list[0].statusCategory.id,
        count:list.length
      }
    }),'order');
    return statuses;
  },
  getWidthOfStatus: function (list) {
    return 100/list.length
  },
  selectProject: function () {
    return !Session.get('reportProject')
  },
  noDataInProject: function () {
    let list = Session.get('reportProjectJiraIssues');
    return ( list && list.length === 0 ) && list !== false
  },
  noConnection: function () {
    let list = Session.get('reportProjectJiraIssues');
    return list === false
  },
  requestInProgress: function () {
    let list = Session.get('reportProjectJiraIssues');
    return list !== false && Session.get('companyProjects') && Session.get('companyProjects').length > 0 && Session.get('requestInProgress')
  },
  getProjectName: function () {
    let projects = Session.get('companyProjects');
    let current = Session.get('reportProject');
    return current && projects && _.find(projects,function (item) {
      return item._id === current
    }).name
  }
});
