import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {Session} from 'meteor/session';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import {Blaze} from 'meteor/blaze';
import _ from 'underscore';
import {$} from 'meteor/jquery';
import {Roles} from 'meteor/alanning:roles';
import Projects from '/imports/lib/collections/projects';
import Utils from '/imports/lib/utils';
import Notify from '/imports/api/notify';
import Component from '/imports/lib/component/Component';
import Company from '/imports/lib/company/Company';

const COMPONENTS_BLACK = 'componentConfig.blacklist';
const COMPONENTS_WHITE = 'componentConfig.whitelist';
const ADDED = 'added by component context menu';

function isListed(component, arr) {
  return _.some(arr, function (item) {
    return item.key === component.key
  })
}
Template.moduleComponents.onCreated(function () {
  Session.set('listStatus');
});

Template.moduleComponents.onRendered(function () {
  Session.set('moduleComponents', undefined);

   
  this.autorun(function () {
    // Reactive guard: on a hard reload the resume-login handshake has not finished, so this
    // call would be rejected by the DDP auth guard and never retried. userId() alone is not
    // enough - it is restored from localStorage before the handshake completes. Same guard
    // as in moduleDependencies.
    if (Meteor.loggingIn() || !Meteor.userId()) return;
    if (Router.current().params.moduleId) {
      let project = Projects.findOne(Router.current().params.projectId);
      if (!project) {
        project = {name: 'Unassigned Modules', _id: Projects.UNASSIGNED}
      }
      Meteor.callAsync(
        'getModuleComponents',
        Router.current().params.moduleId,
        Router.current().params.query.analysis
      ).then(function(data) {
        // `getModuleComponents` RESOLVES with undefined (not a rejection) when the module does
        // not resolve for the caller's company - a stale deep link, a company switch, or the
        // cold-load window. Leaving that undefined skips the helper body, so `listStatus` is
        // never set and the spinner runs forever; the .catch below does not cover a resolve.
        Session.set('moduleComponents', data || []);
        if (data) {
          _.forEach(data, function (c) {
            const component = new Component(c);
            const commits = component.getMonthlyCommits();
            if (commits && commits.length) {
              const elem = $('#sparkline-' + component.data()._id);
              elem.show();
              elem.find('span').sparkline(commits, {
                type: 'bar',
                height: 20,
                barColor: '#2a94a2'
              });
            }
          });
        }
      }).catch(function (error) {
        // Same reason as in moduleDependencies: an unhandled rejection left the list
        // spinning forever with nothing reported.
        console.error('getModuleComponents failed:', error);
        Session.set('moduleComponents', []);
        Notify.danger('Error: ' + (error.reason || 'could not load module components'));
      });
      $.contextMenu({
        selector: '.ecs-components .panel-body .context-component',
        className: 'context-title',
        items: {
          'm-white': {name: 'Always allow in Module', disabled: false},
          'm-black': {name: 'Always deny in Module', disabled: false},
          'sep1': '---------',
          'p-white': {
            name: 'Always allow in Project', disabled: function () {
              return project._id === Projects.UNASSIGNED
            }
          },
          'p-black': {
            name: 'Always deny in Project', disabled: function () {
              return project._id === Projects.UNASSIGNED
            }
          },
          'sep2': '---------',
          'c-white': {name: 'Always allow in Company', disabled: false},
          'c-black': {name: 'Always deny in Company', disabled: false}
        },
        // eslint-disable-next-line sonarjs/cognitive-complexity
        callback: function (key, opt) {
          const user = Meteor.user();
          const now = new Date();
          if (Roles.userIsInRole(user, ['manager','compliance_manager'],user.profile.companyId)) {
            const company = Session.get('company')
            const companyClass = new Company(company);
            const module = Blaze.getData($('.ecs-components')[0]);
            const project = Projects.findOne(module.projectId);
            const component = Blaze.getData(opt.$trigger[0]).data();
            const comment = 'added by component context menu. By ' + ((user.profile && user.profile.name)
              || (user.emails && user.emails[0] && user.emails[0].address || user.profile.email)) + ', ' + now.toLocaleDateString();
            if (component.key && key === 'm-white') {
              const arr = module.getWhitelistedComponents();
              const originalData = _.clone(arr);
              if (isListed(component, arr) === false) {
                arr.push({key: component.key, version: '*', comment: comment});
                Meteor.callAsync('updateCollection', 'Modules', module._id, COMPONENTS_WHITE, arr, true, originalData);
              } else {
                const filteredArr = _.reject(arr, function (e) {
                  return e.key === component.key;
                });
                if (arr.length !== filteredArr.length) {
                  Meteor.callAsync('updateCollection', 'Modules', module._id, COMPONENTS_WHITE, filteredArr, true, originalData);
                }
              }
            } else if (component.key && key === 'm-black') {
              const arr = module.getBlacklistedComponents();
              const originalData = _.clone(arr);
              if (isListed(component, arr) === false) {
                arr.push({
                  key: component.key,
                  version: '*',
                  comment: ADDED
                });
                Meteor.callAsync('updateCollection', 'Modules', module._id, COMPONENTS_BLACK, arr, true, originalData);
              } else {
                const filteredArr = _.reject(arr, function (e) {
                  return e.key === component.key;
                });
                if (arr.length !== filteredArr.length) {
                  Meteor.callAsync('updateCollection', 'Modules', module._id, COMPONENTS_BLACK, filteredArr, true, originalData);
                }
              }
            } else if (component.key && key === 'p-white') {
              const arr = project.getWhitelistedComponents();
              const originalData = _.clone(arr);
              if (isListed(component, arr) === false) {
                arr.push({key: component.key, version: '*', comment: comment});
                Meteor.callAsync('updateCollection', 'Projects', project._id, COMPONENTS_WHITE, arr, true, originalData);
              } else {
                const filteredArr = _.reject(arr, function (e) {
                  return e.key === component.key;
                });
                if (arr.length !== filteredArr.length) {
                  Meteor.callAsync('updateCollection', 'Projects', project._id, COMPONENTS_WHITE, filteredArr, true, originalData);
                }
              }
            } else if (component.key && key === 'p-black') {
              const arr = project.getBlacklistedComponents();
              const originalData = _.clone(arr);
              if (isListed(component, arr) === false) {
                arr.push({
                  key: component.key,
                  version: '*',
                  comment: ADDED
                });
                Meteor.callAsync('updateCollection', 'Projects', project._id, COMPONENTS_BLACK, arr, true, originalData);
              } else {
                const filteredArr = _.reject(arr, function (e) {
                  return e.key === component.key;
                });
                if (arr.length !== filteredArr.length) {
                  Meteor.callAsync('updateCollection', 'Projects', project._id, COMPONENTS_BLACK, filteredArr, true, originalData);
                }
              }
            } else if (component.key && key === 'c-white') {
              const arr = companyClass.getWhitelistedComponents();
              const originalData = _.clone(arr);
              if (isListed(component, arr) === false) {
                arr.push({key: component.key, version: '*', comment: comment});
                Meteor.callAsync('updateCollection', 'Companies', company._id, COMPONENTS_WHITE, arr, true, originalData);
              } else {
                const filteredArr = _.reject(arr, function (e) {
                  return e.key === component.key;
                });
                if (arr.length !== filteredArr.length) {
                  Meteor.callAsync('updateCollection', 'Companies', company._id, COMPONENTS_WHITE, filteredArr, true, originalData);
                }
              }
            } else if (component.key && key === 'c-black') {
              const arr = companyClass.getBlacklistedComponents();
              const originalData = _.clone(arr);
              if (isListed(component, arr) === false) {
                arr.push({
                  key: component.key,
                  version: '*',
                  comment: ADDED
                });
                Meteor.callAsync('updateCollection', 'Companies', company._id, COMPONENTS_BLACK, arr, true, originalData);
              } else {
                const filteredArr = _.reject(arr, function (e) {
                  return e.key === component.key;
                });
                if (arr.length !== filteredArr.length) {
                  Meteor.callAsync('updateCollection', 'Companies', company._id, COMPONENTS_BLACK, filteredArr, true, originalData);
                }
              }
            }
            let requireWhitelist = company && company.requireWhitelist || project.requireWhitelist;
            if(requireWhitelist){
              let itemType,itemName;
              if(key === 'm-white'){
                itemType = 'module';
                itemName = module.name;
              }
              if(key === 'p-white'){
                itemType = 'project';
                itemName = project.name;

              }
              if(key === 'c-white'){
                itemType = 'company';
                itemName = company.name;
              }
              Meteor.callAsync('notifyAboutWhiteListed',user,component,comment,itemType,itemName)
            }
          }else{
            Notify.danger('You are not allowed to change this settings!');
          }
        }
      });
    }
  });
});

Template.moduleComponents.onDestroyed(function () {
  Session.set('moduleComponents', undefined);
});

Template.moduleComponents.helpers({

  getComponents: function () {
    const module = this;
    const moduleComponents = Session.get('moduleComponents');
    if (module && module._id && moduleComponents) {
      Session.set('listStatus');
      const project = Projects.findOne(module.projectId);
      const company = Session.get('company')
      const companyClass = new Company(company);
      const page = Session.get('pageListNumber') || 1;
      const size = Session.get('pageListSize') || 10;
      const vulnConfidence = Session.get('moduleDetailConfidenceMinScore') || Utils.resolveConfidenceMinScore(module, project, 4);
      let result = Utils.defineComponentsList(module, project, companyClass, moduleComponents, false, vulnConfidence);
      let sorting = Session.get('moduleDetailListSorting');
      result = _.sortBy(result, function (item) {
        return item.getName();
      });
      if (sorting) {
        result = result.reverse();
      }
      let currentComponents = result.slice(size*(page-1),size*page);
      // See moduleDependencies.getComponents: 'empty' = loaded but nothing to show, 0 = a
      // transient empty page slice during load (spinner stays up).
      Session.set('listStatus', result.length ? currentComponents.length : 'empty');
      return {
        filtered:currentComponents,
        all:result
      };
    }
  },

  getTotalComponentCnt: function () {
    const module = this;
    if (module && module._id) {
      const filter = Router.current().params.query.analysis || null;
      const analysis = module.getAnalysis(null, filter);
      return analysis && analysis.getTotalComponentCnt() || 0;
    }
  },

  isInfrastructureModule: function () {
    return (Template.currentData() && Template.currentData().properties &&
      (Template.currentData().properties.architecture === 'infrastructureModule' ||
      Template.currentData().properties.architecture === 'infrastructureTemplate')) ||
      (Template.currentData() && Template.currentData().properties &&
      (Template.currentData().properties.architecture === 'cotsModule' ||
      Template.currentData().properties.architecture === 'cotsTemplate'))
  },
  requestInProgress: function () {
    const status = Session.get('listStatus');
    return (status === 0 || !status);
  }
});

Template.moduleComponentsChart.helpers({
  components: function () {
    let module = Template.currentData();
    if (module && module._id) {
      const project = Projects.findOne(module.projectId);
      const company = Session.get('company')
      const companyClass = new Company(company);
      let component = {};
      const vulnConfidence = Session.get('moduleDetailConfidenceMinScore') || Utils.resolveConfidenceMinScore(module, project, 4);
      let componentList = Utils.defineComponentsList(module, project, companyClass, Session.get('moduleComponents'), true, vulnConfidence);
      component.total = componentList.length;
      component.warnings = _.filter(componentList, function (item) {
        return item.status === 'warnings';
      }).length;
      component.violations = _.filter(componentList, function (item) {
        return item.status === 'violations';
      }).length;
      component.ok = Math.max(0, component.total - component.warnings - component.violations);
      component.okPercent = (component.ok * 100) / component.total;
      component.warningsPercent = (component.warnings * 100) / component.total;
      component.violationsPercent = (component.violations * 100) / component.total;
      return component;
    }
  },
  statistics: function () {
    const module = Template.currentData();
    const filter = Router.current().params.query.analysis || null;
    const statistics = module && module.getStatistics(filter);
    return statistics && statistics.getAll();
  },
  isVersioningDisabled: function () {
    const module = Template.parentData();
    const filter = Router.current().params.query.analysis || null;
    const analysis = module && module.getAnalysis ? module.getAnalysis(null, filter) : false;
    return !(analysis && analysis.versioningConfig && analysis.versioningConfig.enabled)
  },
  getModuleOptions: function () {
    return {
      moduleId:Router.current().params.moduleId,
      projectId:Router.current().params.projectId
    };
  }
});
