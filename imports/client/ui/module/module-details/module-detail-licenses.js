import {Template} from 'meteor/templating';
import {Meteor} from 'meteor/meteor';
import {Blaze} from 'meteor/blaze'
import {Session} from 'meteor/session';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import _ from 'underscore';
import {$} from 'meteor/jquery';
import {Roles} from 'meteor/alanning:roles';
import Projects from '/imports/lib/collections/projects';
import Utils from '/imports/lib/utils';
import {ReactiveMethod} from '/imports/lib/reactiveMethod';
import Notify from '/imports/api/notify';
import Company from '/imports/lib/company/Company';

const COMPONENTS_BLACK = 'componentConfig.blacklist';
const LICENSES_BLACK = 'licenseConfig.blacklist';
const COMPONENTS_WHITE = 'componentConfig.whitelist';
const LICENSES_WHITE = 'licenseConfig.whitelist';
const ADDED = 'added by component context menu';

function isListed(component, arr) {
  return _.some(arr, function (item) {
    return item.key === component.key || item.key === (typeof component.getKey === 'function' && component.getKey())
  })
}
Template.moduleLicenses.onCreated(function () {
  Session.set('listStatus');
});

Template.moduleLicenses.onRendered(function () {
  Session.set('moduleComponents', undefined);

   
  this.autorun(function () {
    $('[data-toggle=popover]').popover();
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
        if (data) {
          Session.set('moduleComponents', data);
        }
      });
      $.contextMenu({
        selector: '.ecs-licenses .panel-body .context-license',
        className: 'context-title license-item',
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
          if (Roles.userIsInRole(user, ['manager','compliance_manager'], user.profile.companyId)) {
            const company = Session.get('company')
            const companyClass = new Company(company);
            const module = Blaze.getData($('.ecs-licenses')[0]);
            const project = Projects.findOne(module.projectId);
            const license = Blaze.getData(opt.$trigger[0]);
            const comment = 'added by license context menu. By ' + ((user.profile && user.profile.name)
              || (user.emails && user.emails[0] && user.emails[0].address || user.profile.email)) + ', ' + now.toLocaleDateString();
            if (license.getKey() && key === 'm-white') {
              const arr = module.getWhitelistedLicenses();
              const originalData = _.clone(arr);
              if (isListed(license, arr) === false) {
                arr.push({key: license.getKey(), comment: comment});
                Meteor.callAsync('updateCollection', 'Modules', module._id, LICENSES_WHITE, arr, true, originalData);
              } else {
                const filteredArr = _.reject(arr, function (e) {
                  return e.key === license.getKey();
                });
                if (arr.length !== filteredArr.length) {
                  Meteor.callAsync('updateCollection', 'Modules', module._id, LICENSES_WHITE, filteredArr, true, originalData);
                }
              }
            } else if (license.getKey() && key === 'm-black') {
              const arr = module.getBlacklistedLicenses();
              const originalData = _.clone(arr);
              if (isListed(license, arr) === false) {
                arr.push({key: license.getKey(), comment: comment});
                Meteor.callAsync('updateCollection', 'Modules', module._id, LICENSES_BLACK, arr, true, originalData);
              } else {
                const filteredArr = _.reject(arr, function (e) {
                  return e.key === license.getKey();
                });
                if (arr.length !== filteredArr.length) {
                  Meteor.callAsync('updateCollection', 'Modules', module._id, LICENSES_BLACK, filteredArr, true, originalData);
                }
              }
            } else if (license.getKey() && key === 'p-white') {
              const arr = project.getWhitelistedLicenses();
              const originalData = _.clone(arr);
              if (isListed(license, arr) === false) {
                arr.push({key: license.getKey(), comment: comment});
                Meteor.callAsync('updateCollection', 'Projects', project._id, LICENSES_WHITE, arr, true, originalData);
              } else {
                const filteredArr = _.reject(arr, function (e) {
                  return e.key === license.getKey();
                });
                if (arr.length !== filteredArr.length) {
                  Meteor.callAsync('updateCollection', 'Projects', project._id, LICENSES_WHITE, filteredArr, true, originalData);
                }
              }
            } else if (license.getKey() && key === 'p-black') {
              const arr = project.getBlacklistedLicenses();
              const originalData = _.clone(arr);
              if (isListed(license, arr) === false) {
                arr.push({key: license.getKey(), comment: comment});
                Meteor.callAsync('updateCollection', 'Projects', project._id, LICENSES_BLACK, arr, true, originalData);
              } else {
                const filteredArr = _.reject(arr, function (e) {
                  return e.key === license.getKey();
                });
                if (arr.length !== filteredArr.length) {
                  Meteor.callAsync('updateCollection', 'Projects', project._id, LICENSES_BLACK, filteredArr, true, originalData);
                }
              }
            } else if (license.getKey() && key === 'c-white') {
              const arr = companyClass.getWhitelistedLicenses();
              const originalData = _.clone(arr);
              if (isListed(license, arr) === false) {
                arr.push({key: license.getKey(), comment: comment});
                Meteor.callAsync('updateCollection', 'Companies', company._id, LICENSES_WHITE, arr, true, originalData);
              } else {
                const filteredArr = _.reject(arr, function (e) {
                  return e.key === license.getKey();
                });
                if (arr.length !== filteredArr.length) {
                  Meteor.callAsync('updateCollection', 'Companies', company._id, LICENSES_WHITE, filteredArr, true, originalData);
                }
              }
            } else if (license.getKey() && key === 'c-black') {
              const arr = companyClass.getBlacklistedLicenses();
              const originalData = _.clone(arr);
              if (isListed(license, arr) === false) {
                arr.push({key: license.getKey(), comment: comment});
                Meteor.callAsync('updateCollection', 'Companies', company._id, LICENSES_BLACK, arr, true, originalData);
              } else {
                const filteredArr = _.reject(arr, function (e) {
                  return e.key === license.getKey();
                });
                if (arr.length !== filteredArr.length) {
                  Meteor.callAsync('updateCollection', 'Companies', company._id, LICENSES_BLACK, filteredArr, true, originalData);
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
              Meteor.callAsync('notifyAboutWhiteListed',user,license,comment,itemType,itemName)
            }
          }else{
            Notify.danger('You are not allowed to change this settings!');
          }
        }
      });
      $.contextMenu({
        selector: '.ecs-licenses .panel-body .context-component',
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
          if (Roles.userIsInRole(user, ['manager','compliance_manager'], user.profile.companyId)) {
            const company = Session.get('company')
            const companyClass = new Company(company);
            const module = Blaze.getData($('.ecs-licenses')[0]);
            const project = Projects.findOne(module.projectId);
            const component = Blaze.getData(opt.$trigger[0]).data();
            const comment = 'added by component context menu in licenses. By ' + ((user.profile && user.profile.name)
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
          }else{
            Notify.danger('You are not allowed to change this settings!');
          }
        }
      });
    }
  });
});

Template.moduleLicenses.helpers({

  getLicenseList: function () {
    const module = this;
    if (module && module._id) {
      Session.set('listStatus');
      const project = Projects.findOne(module.projectId);
      const company = Session.get('company')
      const companyClass = new Company(company);
      const page = Session.get('pageListNumber') || 1;
      const size = Session.get('pageListSize') || 10;
      let result = Utils.defineLicenseList(module, project, companyClass, false, Router.current().params.query.analysis);
      let sorting = Session.get('moduleDetailListSorting');
      result = _.sortBy(result, function (item) {
        return item.getName();
      });
      if (sorting) {
        result = result.reverse();
      }
      let currentLicenses = result && result.length ? result.slice(size*(page-1),size*page) : [];
      Session.set('listStatus', result && result.length ? currentLicenses.length : 'empty');
      return {
        filtered:currentLicenses,
        all:result
      };
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
  getLicenseDetails: function () {
    const module = this;
    const template = Session.get('infrastructureTemplate');
    let crawlerInfo = template ? template.crawlerInfo : module.crawlerInfo;
    return ReactiveMethod.call('getLicenseDetails',crawlerInfo.info.license)
  },
  getViabilityDetails: function () {
    const module = this;
    const template = Session.get('infrastructureTemplate');
    return template ? template.crawlerInfo : module.crawlerInfo
  },
  getVulnerabilityDetails: function () {
    const module = this;
    const template = Session.get('infrastructureTemplate');
    return template ? template.crawlerInfo.vulnerability : module.crawlerInfo.vulnerability
  },
  getDescription: function () {
    const module = this;
    const template = Session.get('infrastructureTemplate');
    return module.description ? module.description : template && template.description
  },
  requestInProgress: function () {
    const status = Session.get('listStatus');
    return (status === 0 || !status);
  },
  moduleListFilterOptions: function () {
    return {
      resetOnLoad:true
    };
  },
  isDescSorting: function () {
    return Session.get('moduleDetailListSorting') || false;
  }
});

Template.moduleLicenses.events({
  'keyup .module-deps-search input[name=search]': function (event) {
    Session.set('moduleDetailListFilter', event.target.value);
    Session.set('pageListNumber', 1);
  },
  'click .module-deps-heading .sorting': function () {
    Session.set('moduleDetailListSorting', !Session.get('moduleDetailListSorting'));
  },
  'click .module-deps-heading .expand-all, click .module-deps-heading .collapse-all': function (event) {
    event.preventDefault();
    let heading = $(event.target).closest('.module-deps-heading-left');
    let panelEl = $(event.target).closest('.ts-panel');
    let icon = panelEl.find('.expand-table').find('i.ts-panel-toggle');
    let body = panelEl.find('.table-collapse, .description');
    if (heading.find('.hidden').hasClass('collapse-all')) {
      Session.set('showAll', true);
      Meteor.setTimeout(function () {
        let bodyComponent = panelEl.find('.component-table-collapse');
        bodyComponent.slideDown(0);
        body.slideDown(300);
        panelEl.removeClass('collapsed');
        icon.toggleClass('fa-chevron-right fa-chevron-down');
      }, 100);
    } else {
      Session.set('showAll');
      Meteor.setTimeout(function () {
        let bodyComponent = panelEl.find('.component-table-collapse');
        bodyComponent.slideUp(0);
        body.slideUp(300);
        panelEl.addClass('collapsed');
        icon.toggleClass('fa-chevron-down fa-chevron-right');
      }, 100);
    }
    heading.find('.expand-all, .collapse-all').toggleClass('hidden');
  }
});

Template.moduleLicensesChart.helpers({
  statistics: function () {
    const module = Template.currentData();
    const filter = Router.current().params.query.analysis || null;
    const statistics = module && module.getStatistics(filter);
    return statistics && statistics.getAll();
  },
  licenses: function () {
    let module = Template.currentData();
    if (module && module._id) {
      const project = Projects.findOne(module.projectId);
      const company = Session.get('company')
      const companyClass = new Company(company);
      let license = {};
      let licenses = Utils.defineLicenseList(module, project, companyClass, true, Router.current().params.query.analysis);
      license.total = licenses.length;
      license.warnings = _.filter(licenses, function (item) {
        return item.status === 'warnings';
      }).length;
      license.violations = _.filter(licenses, function (item) {
        return item.status === 'violations';
      }).length;
      license.ok = Math.max(0, license.total - license.warnings - license.violations);
      if (license.total !== 0) {
        license.okPercent = (license.ok * 100) / license.total;
        license.warningsPercent = (license.warnings * 100) / license.total;
        license.violationsPercent = (license.violations * 100) / license.total;
      } else {
        license.okPercent = 0;
        license.warningsPercent = 0;
        license.violationsPercent = 0;
      }
      return license;
    }
  }
});


