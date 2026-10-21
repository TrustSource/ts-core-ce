import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {$} from 'meteor/jquery';
import _ from 'underscore';
import {Session} from 'meteor/session';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import {ReactiveMethod} from '/imports/lib/reactiveMethod';
import Projects from '/imports/lib/collections/projects';
import Notify from '/imports/api/notify';
import pdfMake from 'pdfmake/build/pdfmake.js';
import 'pdfmake/build/vfs_fonts.js';
import reportCreditsService from '/imports/lib/reports/reportCreditsService';
import {Config} from '/imports/config';


Template.reportCredits.onRendered(function () {
  const projectId = Router.current().params.query.projectId;
  const moduleId = Router.current().params.query.moduleId;
  if(projectId) {
    let newUrl = Router.current().route.path() + '?projectId=' + projectId;
    if (moduleId) {
      newUrl = newUrl + '&moduleId=' + moduleId;
    }
    Router.go(newUrl);
  }
  Session.set('requestInProgress');
  Session.set('reportProjectCredits');
  let timerId = Meteor.setInterval(function () {
    if(Session.get('modulesByProject')) {
      let result = Projects.findMapped();
      Session.set('companyProjects', result);
      Meteor.clearInterval(timerId);
      Meteor.setTimeout(function () {
        $('.select2').select2({width: '100%'});
      },1)
    }
  }, 100)
});

Template.reportCredits.events = {
  'change .current-project': function (event) {
    let currentCode = $(event.target).val();
    let moduleId = currentCode.split('_m_')[1];
    let projectId = currentCode.split('_m_')[0];
    let newUrl = Router.current().route.path()+'?projectId='+projectId;
    if (moduleId) {
      newUrl = newUrl + '&moduleId='+moduleId;
    }
    Router.go(newUrl);
  },
  'click .export-as-pdf': function () {
    let reportData = Session.get('reportProjectCredits');
    let report = reportCreditsService.getPdfDetails(reportData);
    try{
      pdfMake.createPdf(report).download(reportData.project.name+'-credits.pdf');
    }catch (error){
      if(error.indexOf('invalid image') > -1){
        Notify.danger('Please check the logo URL at [Settings > General info]. We were not able to retrieve a valid logo file.');
      }else{
        Notify.danger(error);
      }
    }
  }
};
Template.reportCredits.helpers({
  currentProject: function () {
    return Projects.findOne(Router.current().params.query.projectId);
  },
  haveDescription: function (description) {
    return description && description.length > 0
  },
  projectList: function () {
    return Session.get('companyProjects');
  },
  getProjectData:function () {
    const user = Meteor.user();
    let reportProject = Router.current().params.query.projectId;
    let reportModule = Router.current().params.query.moduleId || null;
    if(reportProject && reportProject.length > 0){
      Session.set('requestInProgress', true);
      let getList = ReactiveMethod.call('getProjectCredits',reportProject,user.profile.companyId, reportModule);
      Session.set('reportProjectCredits', getList);
      if(getList){
        Session.set('requestInProgress', false);
        return getList.list
      }else{
        return []
      }
    }else{
      Session.set('requestInProgress');
      Session.set('reportProjectCredits');
      return []
    }
  },
  getProjectStatus: function () {
    return Session.get('reportProjectCredits')
  },
  getProjectDataStats: function () {
    const projectLicenses = Session.get('reportProjectCredits');
    return projectLicenses && projectLicenses.stats
  },
  isActiveProject:function () {
    return !Router.current().params.query.moduleId && Router.current().params.query.projectId === this._id
  },
  isActiveModule:function () {
    return Router.current().params.query.moduleId === this._id
  },
  getPluralized: function (text,list) {
    return reportCreditsService.getPluralized(text,list)
  },
  selectProject: function () {
    return !Router.current().params.query.projectId
  },
  selectedModule: function () {
    return !Router.current().params.query.moduleId
  },
  noDataInProject: function () {
    return Session.get('reportProjectCredits') && Session.get('reportProjectCredits').length === 0
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
  getCorrentLicenseUrl: function () {
    if (this.licenseUrl){
      return this.licenseUrl
    }else{
      return Config.appUrl +'licenses/'+this.licenseKey
    }
  }
});
