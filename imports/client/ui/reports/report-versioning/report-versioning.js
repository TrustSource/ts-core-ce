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
import reportVersioningService from '/imports/lib/reports/reportVersioningService';

function initProjectList() {
  let result = Projects.findMapped();

  if(!Session.get('reportProject') || !_.any(result,function (item) {return item._id === Session.get('reportProject')})){
    Session.set('reportProject',result[0] && result[0]._id);
  }
  Session.set('companyProjects',result);
}

Template.reportVersioning.onRendered(function () {
  const routerProjectId = Router.current().params.hash;
  if(routerProjectId){
    Session.set('reportProject',routerProjectId);
  }
  this.autorun(function () {
    initProjectList();
    Meteor.setTimeout(function () {
      $('.select2').select2({width: '100%'});
    }, 1);
  });
});
Template.reportVersioning.events = {
  'change .current-project': function (event) {
    const routerProjectId = $(event.target).val();
    Session.set('reportProject', routerProjectId);
  },
  'click .export-as-pdf': function () {
    let reportData = Session.get('reportProjectVersioning');
    let report = reportVersioningService.getPdfDetails(reportData);
    try{
      pdfMake.createPdf(report).download(reportData.project.name+'-versioning-report.pdf');
    }catch (error){
      if(error.indexOf('invalid image') > -1){
        Notify.danger('Please check the logo URL at [Settings > General info]. We were not able to retrieve a valid logo file.');
      }else{
        Notify.danger(error);
      }
    }
  }
};
Template.reportVersioning.helpers({
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
    return reportVersioningService.getPluralized(text,list)
  },
  getProjectVersioning:function () {
    const user = Meteor.user();
    if(Session.get('reportProject')){
      Session.set('requestInProgress', true);
      let getList = ReactiveMethod.call('getProjectVersioning',Session.get('reportProject'),user.profile.companyId);
      Session.set('reportProjectVersioning', getList);
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
    return Session.get('reportProjectVersioning');
  },
  isActiveProject:function () {
    return Session.get('reportProject') === this._id
  },
  counterComponents: function () {
    const projectLicenses = Session.get('reportProjectVersioning');
    return projectLicenses && projectLicenses.stats.components
  },
  counterComponentsTotal: function () {
    const projectLicenses = Session.get('reportProjectVersioning');
    return projectLicenses && projectLicenses.stats.componentsTotal
  },
  counterModules: function () {
    const projectLicenses = Session.get('reportProjectVersioning');
    return projectLicenses && projectLicenses.stats.modules
  },
  selectProject: function () {
    return !Session.get('reportProject')
  },
  noDataInProject: function () {
    return Session.get('reportProjectVersioning') && Session.get('reportProjectVersioning').list.length === 0
  },
  requestInProgress: function () {
    return Session.get('companyProjects') && Session.get('companyProjects').length > 0 && Session.get('requestInProgress')
  },
  getProjectName: function () {
    let projects = Session.get('companyProjects');
    let current = Session.get('reportProject');
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
        filter: path.componentKey
      }
    };
  }
});
