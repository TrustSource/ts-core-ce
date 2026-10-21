import {Template} from 'meteor/templating';
import {ReactiveMethod} from '/imports/lib/reactiveMethod';
import _ from 'underscore';
import {Session} from 'meteor/session';
import Projects from '/imports/lib/collections/projects';
import reportVulnerabilityService from '/imports/lib/reports/reportVulnerabilityService';
import ApprovalReports from '/imports/lib/collections/approvalReports';

function getModuleIds(approval) {
  return _.map(approval.modules,function (module) {
    return module._id
  });
}

Template.approvesVersioning.helpers({
  getProjectComponents:function () {
    const approve = this;
    Session.set('requestInProgress', true);
    Session.set('reportProjectComponents');
    let getList = ApprovalReports.findOne({type:'versioning',approveId:approve._id});
    Session.set('reportProjectComponents', getList && getList.data);
    Session.set('requestInProgress', false);
    if(getList){
      return getList.data.list
    }else{
      let {projectId, companyId, modules} = approve
      const moduleIds = getModuleIds(approve)
      let getList = ReactiveMethod.call('getProjectVersioning', projectId, companyId, moduleIds, modules);
      Session.set('reportProjectComponents', getList);
      Session.set('requestInProgress', false);
      if(getList){
        return getList.list
      }else{
        return []
      }
    }
  },
  getPluralized: function (text,list) {
    return reportVulnerabilityService.getPluralized(text,list)
  },
  counterComponents: function () {
    const projectLicenses = Session.get('reportProjectComponents');
    return projectLicenses && projectLicenses.stats.components
  },
  counterComponentsTotal: function () {
    const projectLicenses = Session.get('reportProjectComponents');
    return projectLicenses && projectLicenses.stats.componentsTotal
  },
  counterModules: function () {
    const projectLicenses = Session.get('reportProjectComponents');
    return projectLicenses && projectLicenses.stats.modules
  },
  noDataInProject: function () {
    return Session.get('reportProjectComponents') && Session.get('reportProjectComponents').list.length === 0
  },
  requestInProgress: function () {
    return Session.get('requestInProgress')
  },
  actionRoute: function () {
    const path = this;
    const approve = Template.parentData(2);
    const module = _.find(approve.modules, function (moduleData) {
      return moduleData._id === path.moduleId
    });
    let route = {
      route: 'moduleDependencies',
      params: {
        projectId: approve.projectId || Projects.UNASSIGNED,
        moduleId: path.moduleId
      }
    };
    if(!route.query){
      route.query = {};
    }
    if(module && module.analysisId){
      route.query.analysis = module.analysisId;
    }
    if(route){
      route.query.filter = path.componentKey;
    }
    return route
  }
});
