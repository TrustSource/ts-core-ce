import {Meteor} from 'meteor/meteor';
import {ReactiveMethod} from '/imports/lib/reactiveMethod';
import {Template} from 'meteor/templating';
import _ from 'underscore';
import {Session} from 'meteor/session';
import Projects from '/imports/lib/collections/projects';
import reportVulnerabilityService from '/imports/lib/reports/reportVulnerabilityService';
import ApprovalReports from '/imports/lib/collections/approvalReports';
import Component from '/imports/lib/component/Component';
import {$} from 'meteor/jquery';

function getModuleIds(approval) {
  return _.map(approval.modules,function (module) {
    return module._id
  });
}

Template.approvesViability.helpers({
  getProjectComponents:function () {
    const approve = this;
    Session.set('requestInProgress', true);
    Session.set('reportProjectComponents');
    let getList = ApprovalReports.findOne({type:'viability',approveId:approve._id});
    Session.set('reportProjectComponents', getList && getList.data);
    Session.set('requestInProgress', false);
    if(getList){
      let list = _.map(getList.data.list,function (component) {
        let newComponent =  new Component(component);
        newComponent.counter = component.counter;
        Meteor.setTimeout(function () {
          const commits = newComponent.getMonthlyCommits();
          if (commits && commits.length) {
            const elem = $('#sparkline-' + newComponent.data()._id);
            elem.show();
            elem.find('span').sparkline(commits, {
              type: 'bar',
              height: 20,
              barColor: '#2a94a2'
            });
          }
        },1);
        return newComponent
      });
      return list
    }else{
      let {projectId, companyId, modules} = approve
      const moduleIds = getModuleIds(approve)
      let getList = ReactiveMethod.call('getProjectViability', projectId, companyId, moduleIds, modules);
      Session.set('reportProjectComponents', getList);
      Session.set('requestInProgress', false);
      if(getList){
        let list = _.map(getList.list,function (component) {
          let newComponent =  new Component(component);
          newComponent.counter = component.counter;
          Meteor.setTimeout(function () {
            const commits = newComponent.getMonthlyCommits();
            if (commits && commits.length) {
              const elem = $('#sparkline-' + newComponent.data()._id);
              elem.show();
              elem.find('span').sparkline(commits, {
                type: 'bar',
                height: 20,
                barColor: '#2a94a2'
              });
            }
          },1);
          return newComponent
        });
        return list
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
  counterModules: function () {
    const projectLicenses = Session.get('reportProjectComponents');
    return projectLicenses && projectLicenses.stats.modules
  },
  counterWithoutViability: function () {
    const projectLicenses = Session.get('reportProjectComponents');
    return projectLicenses && projectLicenses.stats.withoutViability
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
