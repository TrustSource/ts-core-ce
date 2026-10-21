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
import reportCotsService from '/imports/lib/reports/reportCotsService';

function initProjectList() {
  let result = Projects.findMapped();

  if(!Session.get('reportProject') || !_.any(result,function (item) {return item._id === Session.get('reportProject')})){
    Session.set('reportProject',result[0] && result[0]._id);
  }
  Session.set('companyProjects',result);
}

Template.reportCots.onRendered(function () {
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
Template.reportCots.events = {
  'change .current-project': function (event) {
    const routerProjectId = $(event.target).val();
    Session.set('reportProject', routerProjectId);
  },
  'click .export-as-pdf': function () {
    let reportData = Session.get('reportProjectCots');
    let report = reportCotsService.getPdfDetails(reportData);
    try{
      pdfMake.createPdf(report).download(reportData.project.name+'-cots-report.pdf');
    }catch (error){
      if(error.indexOf('invalid image') > -1){
        Notify.danger('Please check the logo URL at [Settings > General info]. We were not able to retrieve a valid logo file.');
      }else{
        Notify.danger(error);
      }
    }
  }
};
Template.reportCots.helpers({
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
  getProjectCots:function () {
    const user = Meteor.user();
    if(Session.get('reportProject')){
      Session.set('requestInProgress', true);
      let getList = ReactiveMethod.call('getProjectCots',Session.get('reportProject'),user.profile.companyId);
      Session.set('reportProjectCots', getList);
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
  getProjectCotsStatus: function () {
    return Session.get('reportProjectCots');
  },
  isActiveProject:function () {
    return Session.get('reportProject') === this._id
  },
  counterComponents: function () {
    const projectLicenses = Session.get('reportProjectCots');
    return projectLicenses && projectLicenses.stats.components
  },
  selectProject: function () {
    return !Session.get('reportProject')
  },
  noDataInProject: function () {
    return Session.get('reportProjectCots') && Session.get('reportProjectCots').length === 0
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
  }
});
