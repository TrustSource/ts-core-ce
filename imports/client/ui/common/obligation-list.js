import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {$} from 'meteor/jquery';
import _ from 'underscore';
import {Session} from 'meteor/session';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import {Roles} from 'meteor/alanning:roles';
import {ReactiveMethod} from '/imports/lib/reactiveMethod';
import Projects from '/imports/lib/collections/projects';
import Notify from '/imports/api/notify';
import Clipboard from 'clipboard';
import pdfMake from 'pdfmake/build/pdfmake.js';
import 'pdfmake/build/vfs_fonts.js';
import reportObligationsService from '/imports/lib/reports/reportObligationsService';

Template.obligationList.onCreated(function () {
  $.fn.modal.Constructor.prototype.enforceFocus = function() {};

  let clipboard = new Clipboard('.copy-obligation-text');

  clipboard.on('success', function (e) {
    Notify.success('Obligation was successfully copied');
    e.clearSelection();
  });
});

Template.obligationList.onRendered(function () {
  Session.set('requestInProgress', true);
  Session.set('reportProjectObligations');
});

function markObligation(user, obligation, comment) {
  Session.set('listUpdateActionInProgress', true);
  if (Roles.userIsInRole(user, ['manager','compliance_manager'], user.profile.companyId)) {
    const project = Projects.findOne(Router.current().params.query.projectId);
    let arr = project.getCompletedObligations();
    const originalData = _.clone(arr);
    let filteredArr = _.reject(arr, function (e) {
      return e.obligationKey === obligation.key
    });
    filteredArr.push({obligationKey: obligation.key, comment: comment});
    Meteor.callAsync('updateCollection', 'Projects', project._id, 'obligationConfig', filteredArr, true, originalData);
  }else{
    Notify.danger('You are not allowed to change this settings!');
  }
  Session.set('listUpdateActionInProgress');
}

Template.obligationList.events = {
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
  'change .obligation-comment': function (event) {
    const obligation = this;
    const user = Meteor.user();
    const comment = $(event.target).val();
    markObligation(user, obligation,comment);
  },
  'click .mark-complete-project-obligations': function () {
    const obligation = this;
    const user = Meteor.user();
    const now = new Date();
    const comment = 'Added from obligations report. By ' + ((user.profile && user.profile.name)
      || (user.emails && user.emails[0] && user.emails[0].address || user.profile.email))
      + ', ' + now.toLocaleDateString();
    markObligation(user, obligation,comment);
  },
  'click .unmark-complete-project-obligations': function () {
    Session.set('listUpdateActionInProgress', true);
    const obligation = this;
    const user = Meteor.user();
    if (Roles.userIsInRole(user, ['manager','compliance_manager'], user.profile.companyId)) {
      const project = Projects.findOne(Router.current().params.query.projectId || Router.current().params.projectId);
      const arr = project.getCompletedObligations();
      const originalData = _.clone(arr);
      let filteredArr = _.reject(arr, function (e) {
        return e.obligationKey === obligation.key
      });
      if (arr.length !== filteredArr.length) {
        Meteor.callAsync('updateCollection', 'Projects', project._id, 'obligationConfig', filteredArr, true, originalData);
      }
    }else{
      Notify.danger('You are not allowed to change this settings!');
    }
    Session.set('listUpdateActionInProgress');
  },
  'click .show-more .btn': function () {
    const obligation = this;
    return Session.set('Show-'+obligation.key,true);
  },
  'click .show-less .btn': function () {
    const obligation = this;
    return Session.set('Show-'+obligation.key,false);
  },
  'click .export-as-pdf': function () {
    let reportData = Session.get('reportProjectObligations');
    let report = reportObligationsService.getPdfDetails(reportData);
    try{
      pdfMake.createPdf(report).download(reportData.project.name+'-obligation-report.pdf');
    }catch (error){
      if(error.indexOf('invalid image') > -1){
        Notify.danger('Please check the logo URL at [Settings > General info]. We were not able to retrieve a valid logo file.');
      }else{
        Notify.danger(error);
      }
    }
  }
};

Template.obligationList.helpers({
  hasProjectObligations: function () {
    const user = Meteor.user();
    const projectId = Router.current().params.projectId || (Router.current().params.query && Router.current().params.query.projectId);
    if(projectId){
      Session.set('requestInProgress', true);
      const moduleId = Router.current().params.moduleId || (Router.current().params.query && Router.current().params.query.moduleId);
      const moduleIds = moduleId ? [moduleId]: false;
      let getList = ReactiveMethod.call('getProjectObligations', projectId, user.profile.companyId, moduleIds);
      Session.set('reportProjectObligations', getList);
      if(getList){
        Session.set('requestInProgress', false);
        return getList.list
      }else{
        return []
      }
    }
  },
  getProjectObligations:function () {
    let getList = Session.get('reportProjectObligations');
    return getList.list;
  },
  getObligationDescription: function (obligationKey) {
    return reportObligationsService.getObligationDescription(obligationKey)
  },
  getObligationSuggestion: function (obligationKey) {
    return reportObligationsService.getObligationSuggestion(obligationKey)
  },
  getObligationComment: function (obligationKey) {
    return reportObligationsService.getObligationComment(obligationKey)
  },
  getObligationStatus: function (obligationKey) {
    return reportObligationsService.getObligationStatus(obligationKey)
  },
  companyId: function () {
    let user = Meteor.user();
    return user && user.profile && user.profile.companyId
  },
  actionRoute: function () {
    const component = this;
    return {
      route: 'moduleDependencies',
      params: {
        projectId: component.projectId || Projects.UNASSIGNED,
        moduleId: component.moduleId
      },
      query: {
        filter: component.componentKey
      }
    }
  },
  hideMore: function (key) {
    return Session.get('Show-'+key);
  },
  getFirstComponent: function () {
    const obligation = this;
    return obligation.components[0];
  },
  moreThanOne: function () {
    const obligation = this;
    return obligation.components.length > 1;
  },
  noDataInProject: function () {
    let getList = Session.get('reportProjectObligations');
    return getList && getList.list && getList.list.length === 0
  },
  requestInProgress: function () {
    return Session.get('requestInProgress')
  },
  modalView: function () {
    return Template.parentData().modalView || Template.parentData(1).modalView
  },
  getProjectName: function () {
    let projects = Session.get('companyProjects');
    let current = Router.current().params.query.projectId;
    return current && projects && _.find(projects,function (item) {
      return item._id === current
    }).name
  },
  getModuleName: function () {
    let project = _.find(Session.get('companyProjects'),function (item) {
      return item._id === Router.current().params.query.projectId
    });
    let current = Router.current().params.query.moduleId;
    return current && project && _.find(project.listModules,function (item) {
      return item._id === current
    }).name
  },
  getObligationEntries: function () {
    if(this && this.components){
      let list = _.map(this.components, function (component) {
        return component.componentKey +' at '+ component.path
      });
      return list.join('; ')
    }
  }
});
