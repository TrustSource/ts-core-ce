import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {$} from 'meteor/jquery';
import _ from 'underscore';
import {Session} from 'meteor/session';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import {ReactiveMethod} from '/imports/lib/reactiveMethod';
import Projects from '/imports/lib/collections/projects';
import Notify from '/imports/api/notify';
import Pluralize from 'pluralize';
import pdfMake from 'pdfmake/build/pdfmake.js';
import 'pdfmake/build/vfs_fonts.js';
import reportLicensesService from '/imports/lib/reports/reportLicensesService';

function initProjectList() {
  let result = Projects.findMapped();

  if(!Session.get('reportProject') || !_.any(result,function (item) {return item._id === Session.get('reportProject')})){
    Session.set('reportProject',result[0] && result[0]._id);
  }
  Session.set('companyProjects',result);
}

Template.reportLicenses.onRendered(function () {
  const routerProjectId = Router.current().params.hash;
  if(routerProjectId){
    Session.set('reportProject',routerProjectId);
  }
  this.autorun(() => {
    initProjectList();
    Meteor.setTimeout(function () {
      $('.select2').select2({width: '100%'});
    }, 1);
  });
});
Template.reportLicenses.events = {
  'change .current-project': function (event) {
    const routerProjectId = $(event.target).val();
    Session.set('reportProject', routerProjectId);
  },
  'click .export-as-pdf': function () {
    let reportData = Session.get('reportProjectLicenses');
    let report = reportLicensesService.getPdfDetails(reportData);
    try{
      pdfMake.createPdf(report).download(reportData.project.name+'-licenses-report.pdf');
    }catch (error){
      if(error.indexOf('invalid image') > -1){
        Notify.danger('Please check the logo URL at [Settings > General info]. We were not able to retrieve a valid logo file.');
      }else{
        Notify.danger(error);
      }
    }
  }
};
Template.reportLicenses.helpers({
  currentProject: function () {
    return Projects.findOne(Session.get('reportProject'));
  },
  haveDescription: function (description) {
    return description && description.length > 0
  },
  projectList: function () {
    return Session.get('companyProjects');
  },
  getProjectLicenses:function () {
    const user = Meteor.user();
    if(Session.get('reportProject')){
      Session.set('requestInProgress', true);
      let getList = ReactiveMethod.call('getProjectLicenses',Session.get('reportProject'),user.profile.companyId);
      Session.set('reportProjectLicenses', getList);
      if(getList){
        Session.set('requestInProgress', false);
        return getList.list
      }else{
        return []
      }
    }
  },
  getProjectLicensesStatus: function () {
    return Session.get('reportProjectLicenses');
  },
  getDeadlyObligations: function () {
    return this.deadlyObligations
  },
  isActiveProject:function () {
    return Session.get('reportProject') === this._id
  },
  getPluralized: function (text,list) {
    return Pluralize(text, list.length || list, true)
  },
  counterLicenses: function () {
    const projectLicenses = Session.get('reportProjectLicenses');
    return projectLicenses && projectLicenses.stats.licenses
  },
  counterComponents: function () {
    const projectLicenses = Session.get('reportProjectLicenses');
    return projectLicenses && projectLicenses.stats.components
  },
  counterObligations: function () {
    const projectLicenses = Session.get('reportProjectLicenses');
    return projectLicenses && projectLicenses.stats.obligations
  },
  describeObligations: function () {
    return reportLicensesService.describeObligations(this.toString())
  },
  describeDeadlyObligations: function () {
    return reportLicensesService.describeDeadlyObligations(this.toString())
  },
  describeViolations: function () {
    return reportLicensesService.describeViolations(this.toString())
  },
  selectProject: function () {
    return !Session.get('reportProject')
  },
  noDataInProject: function () {
    return Session.get('reportProjectLicenses') && Session.get('reportProjectLicenses').length === 0
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
  getRequirements: function () {
    let project =  Projects.findOne(Session.get('reportProject'));
    return (project) ? project.requirements : false
  },
  actionRoute: function () {
    const path = this;
    const license = Template.parentData(1);
    let route = {
      route: 'moduleLicenses',
      params: {
        projectId: Session.get('reportProject') || Projects.UNASSIGNED,
        moduleId: path.module && path.module._id
      }
    };
    if(license){
      route.query = {
        filter: license.key
      };
    }
    return route
  }
});
