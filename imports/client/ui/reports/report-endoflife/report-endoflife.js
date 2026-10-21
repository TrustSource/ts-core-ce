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
import reportEndoflifeService from '/imports/lib/reports/reportEndoflifeService';

function initProjectList() {
  let result = Projects.findMapped();

  const projectId = Session.get('reportProject')
  if(!projectId || (projectId && projectId !== 'ALL' && !_.any(result,function (item) {return item._id === projectId}))){
    Session.set('reportProject',result[0] && result[0]._id);
  }
  Session.set('companyProjects',result);
}

Template.reportEndoflife.onRendered(function () {
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
Template.reportEndoflife.events = {
  'change .current-project': function (event) {
    const routerProjectId = $(event.target).val();
    Session.set('reportProject', routerProjectId);
    let newUrl = Router.current().route.path()+'?projectId='+routerProjectId;
    Router.go(newUrl);
  },
  'click .export-as-pdf': function () {
    let reportData = Session.get('reportProjectEndoflife');
    let report = reportEndoflifeService.getPdfDetails(reportData);
    let reportName = reportData && ((reportData.company && reportData.company.name) ||
      (reportData.project && reportData.project.name))
    try{
      pdfMake.createPdf(report).download(reportName+'-end-of-life-report.pdf');
    }catch (error){
      if(error.indexOf('invalid image') > -1){
        Notify.danger('Please check the logo URL at [Settings > General info]. We were not able to retrieve a valid logo file.');
      }else{
        Notify.danger(error);
      }
    }
  },
  'click .send_alert': function (event) {
    event.preventDefault();
    const user = Meteor.user();
    let data = this
    Meteor.callAsync('notifyAboutEndoflifeImpact', user, {
      list: [data]
    }).then(function() {
      Notify.success('Notification about End-of-life sent');
    }).catch(function(error) {
      Notify.danger('Error: ' + (error.reason || ' could not send notification'));
    })
  }
};
Template.reportEndoflife.helpers({
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
    return reportEndoflifeService.getPluralized(text,list)
  },
  reportProjectEndoflife:function () {
    const user = Meteor.user();
    const projectId = Session.get('reportProject')
    if(projectId){
      Session.set('requestInProgress', true);
      let projectParam = projectId === 'ALL' ? null : projectId;
      let getList = ReactiveMethod.call('getProjectEndoflife',projectParam,user.profile.companyId);
      Session.set('reportProjectEndoflife', getList);
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
  reportProjectEndoflifeStatus: function () {
    return Session.get('reportProjectEndoflife');
  },
  isActiveProject:function () {
    return Session.get('reportProject') === this._id
  },
  counterWarnings: function () {
    const projectLicenses = Session.get('reportProjectEndoflife');
    return projectLicenses && projectLicenses.stats.warnings
  },
  counterViolations: function () {
    const projectLicenses = Session.get('reportProjectEndoflife');
    return projectLicenses && projectLicenses.stats.violations
  },
  counterComponentsTotal: function () {
    const projectLicenses = Session.get('reportProjectEndoflife');
    return projectLicenses && projectLicenses.stats.componentsTotal
  },
  counterModules: function () {
    const projectLicenses = Session.get('reportProjectEndoflife');
    return projectLicenses && projectLicenses.stats.modules
  },
  selectProject: function () {
    return !Session.get('reportProject')
  },
  noDataInProject: function () {
    return Session.get('reportProjectEndoflife') && Session.get('reportProjectEndoflife').list.length === 0
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
        projectId: path.projectId || Session.get('reportProject') || Projects.UNASSIGNED,
        moduleId: path.moduleId
      },
      query: {
        filter: path.componentKey
      }
    };
  },
  getPaths: function () {
    let list = this.paths
    let project = this.project;
    if(project){
      list.map(item => item.project = project)
    }
    return list
  },
  isActivePortfolio:function () {
    return Session.get('reportProject') === 'ALL'
  },
  getProblemDescription: function () {
    const self = this;
    const messages = self.problems.map(item => item.message)
    const projects = Session.get('companyProjects')
    const projectIds = self.paths.map(item => item.projectId)
    const projectNames = projects && projectIds && _.map(_.filter(projects,function (item)
    {return projectIds.indexOf(item._id) > -1}), item => item.name).join(', ')
    return {
      text: `End-of-life of ${self.key} "`+ messages.join('; ') +'" in "' + (projectNames
        || 'REMOVED_PROJECT') + '" \n',
      title: self.key + ' (End-of-life related task)'
    }
  },
  getPathsProject: function () {
    const self = this;
    const projects = Session.get('companyProjects')
    const project = projects.find(item => self.projectId === item._id)
    return project && project.name ? `${project.name} > ` : ''
  },
  getRepository: function () {
    const self = this;
    const projects = Session.get('companyProjects')
    const project = projects && self.project && _.find(projects,function (item) {return item._id === self.project._id})
    const projectRepo = project && project.repository ? project.repository : null
    const company = Session.get('company');
    const companyRepo = company && company.github && company.github.active ? company.github.repository : null
    return projectRepo || companyRepo
  }
});
