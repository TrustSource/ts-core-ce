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
import reportAlgorithmsService from '/imports/lib/reports/reportAlgorithmsService';

function initProjectList() {
  let result = Projects.findMapped();
  const projectId = Session.get('reportProject')
  if(!projectId || (projectId && projectId !== 'ALL' && !_.any(result,function (item) {return item._id === projectId}))){
    Session.set('reportProject',result[0] && result[0]._id);
  }
  Session.set('companyProjects',result);
}

Template.reportAlgorithms.onRendered(function () {
  const routerQuery = Router.current().params.query;
  if(routerQuery && routerQuery.projectId){
    Session.set('reportProject', routerQuery.projectId);
  }
  this.autorun(function () {
    initProjectList();
    Meteor.setTimeout(function () {
      $('.select2').select2({width: '100%'});
    }, 1);
  });
});
Template.reportAlgorithms.events = {
  'change .current-project': function (event) {
    const routerProjectId = $(event.target).val();
    Session.set('reportProject', routerProjectId);
    let newUrl = Router.current().route.path()+'?projectId='+routerProjectId;
    Router.go(newUrl);
  },
  'click .export-as-pdf': function () {
    let reportData = Session.get('reportProjectAlgorithms');
    let report = reportAlgorithmsService.getPdfDetails(reportData);
    try{
      pdfMake.createPdf(report).download(reportData.project.name+'-algorithms-report.pdf');
    }catch (error){
      if(error.indexOf('invalid image') > -1){
        Notify.danger('Please check the logo URL at [Settings > General info]. We were not able to retrieve a valid logo file.');
      }else{
        Notify.danger(error);
      }
    }
  }
};
Template.reportAlgorithms.helpers({
  currentProject: function () {
    return Projects.findOne(Session.get('reportProject'));
  },
  getModuleOptions: function () {
    return {
      params: {
        projectId: Session.get('reportProject'),
        moduleId: this.moduleId || this._id
      },
      query: {
        filter: this.key
      }
    };
  },
  projectList: function () {
    return Session.get('companyProjects');
  },
  getPluralized: function (text,list) {
    return reportAlgorithmsService.getPluralized(text,list)
  },
  getProjectVersioning:function () {
    const user = Meteor.user();
    if(Session.get('reportProject')){
      Session.set('requestInProgress', true);
      let getList = ReactiveMethod.call('getProjectAlgorithms',Session.get('reportProject'),user.profile.companyId);
      Session.set('reportProjectAlgorithms', getList);
      if(getList){
        Session.set('requestInProgress', false);
        return getList.list
      }else{
        return []
      }
    }
  },
  compare: function (a, b) {
    return a === b
  },
  getProjectVersioningStatus: function () {
    return Session.get('reportProjectAlgorithms');
  },
  isActiveProject:function () {
    return Session.get('reportProject') === this._id
  },
  counterComponents: function () {
    const projectLicenses = Session.get('reportProjectAlgorithms');
    return projectLicenses && projectLicenses.stats.componentWithAlgorithms
  },
  counterModules: function () {
    const projectLicenses = Session.get('reportProjectAlgorithms');
    return projectLicenses && projectLicenses.stats.modules
  },
  selectProject: function () {
    return !Session.get('reportProject')
  },
  noDataInProject: function () {
    return Session.get('reportProjectAlgorithms') && Session.get('reportProjectAlgorithms').list.length === 0
  },
  requestInProgress: function () {
    return Session.get('companyProjects') && Session.get('companyProjects').length > 0 && Session.get('requestInProgress')
  },
  getProjectName: function () {
    let projects = Session.get('companyProjects');
    let current = Session.get('reportProject');
    if(current === 'ALL'){
      return 'Whole portfolio'
    }
    return current && projects && _.find(projects,function (item) {
      return item._id === current
    }).name
  },
  actionRoute: function () {
    const path = this;
    return {
      route: 'moduleDependencies',
      params: {
        projectId: Session.get('reportProject') || Projects.UNASSIGNED,
        moduleId: path.moduleId
      },
      query: {
        filter: path.key
      }
    };
  },
  isDenied: function () {
    const company = Session.get('company');
    let self = this;
    if(company && company.blacklistedAlgorithms && company.blacklistedAlgorithms.length){
      return company.blacklistedAlgorithms.some(algorithm => {
        if(!algorithm.key || !self.algorithm){
          return false;
        }
        return algorithm.key.toLowerCase() === self.algorithm.toLowerCase();
      })
    }else{
      return false
    }
  }
});
