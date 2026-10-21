import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {$} from 'meteor/jquery';
import _ from 'underscore';
import {Session} from 'meteor/session';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import {ReactiveMethod} from '/imports/lib/reactiveMethod';
import Projects from '/imports/lib/collections/projects';


Template.reportCriticalComponents.onRendered(function () {
  let result = Projects.findMapped();
  const projectId = Router.current().params.query.projectId;
  if(projectId) {
    let newUrl = Router.current().route.path() + '?projectId=' + projectId;
    Router.go(newUrl);
  }
  Session.set('companyProjects',result);
  Session.set('requestInProgress');
  Session.set('reportProjectData');
  Meteor.setTimeout(function () {
    $('.select2').select2({width: '100%'});
  },1)
});

Template.reportCriticalComponents.events = {
  'change .current-project': function (event) {
    let currentCode = $(event.target).val();
    let projectId = currentCode.split('_m_')[0];
    let newUrl = Router.current().route.path()+'?projectId='+projectId;
    Router.go(newUrl);
  }
};
Template.reportCriticalComponents.helpers({
  projectList: function () {
    return Session.get('companyProjects');
  },
  getProjectData:function () {
    const user = Meteor.user();
    let reportProject = Router.current().params.query.projectId;
    if(reportProject && reportProject.length > 0){
      Session.set('requestInProgress', true);
      let getList = ReactiveMethod.call('getProjectCriticalComponents',reportProject,user.profile.companyId);
      Session.set('reportProjectData', getList);
      if(getList){
        Session.set('requestInProgress', false);
        return getList.list
      }else{
        return []
      }
    }else{
      Session.set('requestInProgress');
      Session.set('reportProjectData');
      return []
    }
  },
  getProjectStatus: function () {
    return Session.get('reportProjectData')
  },
  getProjectStats: function () {
    const projectLicenses = Session.get('reportProjectData');
    return projectLicenses && projectLicenses.stats
  },
  isActiveProject:function () {
    return Router.current().params.query.projectId === this._id
  },
  selectProject: function () {
    return !Router.current().params.query.projectId
  },
  selectedModule: function () {
    return !Router.current().params.query.moduleId
  },
  noDataInProject: function () {
    return Session.get('reportProjectData') && Session.get('reportProjectData').length === 0
  },
  requestInProgress: function () {
    return Session.get('companyProjects') && Session.get('companyProjects').length > 0 && Session.get('requestInProgress')
  },
  getProjectName: function () {
    let projects = Session.get('companyProjects');
    let current = Router.current().params.query.projectId;
    return current && projects && _.find(projects,function (item) {
      return item._id === current
    }).name
  },
  incIndex: function (index) {
    return index + 1
  },
  getOptions: function () {
    return {_id: this._id}
  }
});
