/* global Blob:false, document:false, window:false */

import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {$} from 'meteor/jquery';
import _ from 'underscore';
import {Session} from 'meteor/session';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import {ReactiveMethod} from '/imports/lib/reactiveMethod';
import Projects from '/imports/lib/collections/projects';
import Notify from '/imports/api/notify';
import reportBomService from '/imports/lib/reports/reportBomService';
import {Config} from '/imports/config';
import pdfMake from 'pdfmake/build/pdfmake.js';
import 'pdfmake/build/vfs_fonts.js';


Template.reportBOM.onRendered(function () {
  const projectId = Router.current().params.query.projectId;
  const moduleId = Router.current().params.query.moduleId;
  const approveId = Router.current().params.query.approveId || null;
  if(projectId) {
    let newUrl = Router.current().route.path() + '?projectId=' + projectId;
    if (moduleId) {
      newUrl = newUrl + '&moduleId=' + moduleId;
    }
    if (approveId) {
      newUrl = newUrl + '&approveId=' + approveId;
    }
    Router.go(newUrl);
  }
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
  Session.set('requestInProgress');
  Session.set('reportProjectBom');
});

function getName(data) {
  return data.modules && data.modules.length === 1 ? data.modules && data.modules[0].name || 'Module is N.A.'
    : data.project && data.project.name || 'Project is N.A.';
}

Template.reportBOM.events = {
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
    let reportData = Session.get('reportProjectBom');
    let report = reportBomService.getPdfDetails(reportData);
    try{
      pdfMake.createPdf(report).download(reportData.project.name+'-bill-of-materials.pdf');
    }catch (error){
      if(error.indexOf('invalid image') > -1){
        Notify.danger('Please check the logo URL at [Settings > General info]. We were not able to retrieve a valid logo file.');
      }else{
        Notify.danger(error);
      }
    }
  },
  'click .export-as-cyclonedx': function (event) {
    let variant = (event.currentTarget && event.currentTarget.getAttribute('data-variant')) || 'SBOM';
    let reportData = Session.get('reportProjectBom');
    let report = reportBomService.getCycloneDxDetails(reportData, variant);
    let suffix = '-' + variant.toLowerCase();
    let blob = new Blob([JSON.stringify(report, null, 2)]);
    if (window.navigator.msSaveOrOpenBlob)  // IE hack; see http://msdn.microsoft.com/en-us/library/ie/hh779016.aspx
      window.navigator.msSaveBlob(blob, getName(reportData)+suffix+'.json');
    else{
      let a = window.document.createElement('a');
      a.href = window.URL.createObjectURL(blob, {type: 'application/json'});
      a.download = getName(reportData)+suffix+'.json';
      document.body.appendChild(a);
      a.click();  // IE: "Access is denied";
      // see: https://connect.microsoft.com/IE/feedback/details/797361/ie-10-treats-blob-url-as-cross-origin-and-denies-access
      document.body.removeChild(a);
    }
  },
  'click .export-as-spdx': function () {
    let reportData = Session.get('reportProjectBom');
    let report = reportBomService.getSPDXDetails(reportData);
    let blob = new Blob([JSON.stringify(report, null, 2)]);
    if (window.navigator.msSaveOrOpenBlob)  // IE hack; see http://msdn.microsoft.com/en-us/library/ie/hh779016.aspx
      window.navigator.msSaveBlob(blob, getName(reportData)+'.spdx.json');
    else{
      let a = window.document.createElement('a');
      a.href = window.URL.createObjectURL(blob, {type: 'application/json'});
      a.download = getName(reportData)+'.spdx.json';
      document.body.appendChild(a);
      a.click();  // IE: "Access is denied";
      // see: https://connect.microsoft.com/IE/feedback/details/797361/ie-10-treats-blob-url-as-cross-origin-and-denies-access
      document.body.removeChild(a);
    }
  }
};
Template.reportBOM.helpers({
  currentProject: function () {
    return Projects.findOne(Router.current().params.query.projectId);
  },
  haveDescription: function (description) {
    return description && description.length > 0
  },
  projectList: function () {
    return Session.get('companyProjects');
  },
  getProjectBOM:function () {
    const user = Meteor.user();
    let reportProject = Router.current().params.query.projectId;
    let reportModule = Router.current().params.query.moduleId || null;
    let reportApprove = Router.current().params.query.approveId || null;
    if(reportProject && reportProject.length > 0){
      Session.set('requestInProgress', true);
      let getList = ReactiveMethod.call('getProjectSBOM',reportProject,user.profile.companyId, reportModule, reportApprove);
      Session.set('reportProjectBom', getList);
      if(getList){
        // homepageUrl
        // license
        // licenseUrl
        // licenseKey
        // name
        // version
        Session.set('requestInProgress', false);
        return getList.list
      }else{
        return []
      }
    }else{
      Session.set('requestInProgress');
      Session.set('reportProjectBom');
      return []
    }
  },
  getProjectStatus: function () {
    return Session.get('reportProjectBom')
  },
  getProjectBOMStats: function () {
    const projectLicenses = Session.get('reportProjectBom');
    return projectLicenses && projectLicenses.stats
  },
  isActiveProject:function () {
    return !Router.current().params.query.moduleId && Router.current().params.query.projectId === this._id
  },
  isActiveModule:function () {
    return Router.current().params.query.moduleId === this._id
  },
  getPluralized: function (text,list) {
    return reportBomService.getPluralized(text,list)
  },
  selectProject: function () {
    return !Router.current().params.query.projectId
  },
  selectedModule: function () {
    return !Router.current().params.query.moduleId
  },
  noDataInProject: function () {
    return Session.get('reportProjectBom') && Session.get('reportProjectBom').length === 0
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
