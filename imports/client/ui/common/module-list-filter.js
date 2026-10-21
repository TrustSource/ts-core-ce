/* global document:false */
/* eslint-disable sonarjs/no-duplicated-branches */

import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {Session} from 'meteor/session';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import {Roles} from 'meteor/alanning:roles';
import Projects from '/imports/lib/collections/projects';
import Modules from '/imports/lib/collections/modules';
import Utils from '/imports/lib/utils';
import _ from 'underscore';
import {$} from 'meteor/jquery';
import Notify from '/imports/api/notify';

const NOT_ALLOWED = 'You are not allowed to change this settings!';
const IN_PROGRESS = 'listUpdateActionInProgress';
const ADDED_BY = 'added by list buttons. By ';
const COMPONENTS_BLACK = 'componentConfig.blacklist';
const LICENSES_BLACK = 'licenseConfig.blacklist';
const COMPONENTS_WHITE = 'componentConfig.whitelist';
const LICENSES_WHITE = 'licenseConfig.whitelist';

function resetActions() {
  Session.set('currentComponent');
  Notify.successHtml('Changes successfully saved! <br>' +
    'NOTE: Manual changes will not appear in the component or legal views until you have executed ' +
    'a new analysis run! The views actually are representations of an analysis result.');
  Meteor.callAsync('getCompanyCurrent').then(data => {
    Session.set('company', data)
  }).catch(function(error) {
    console.error('getCompanyCurrent failed:', error);
  })
}

Template.moduleListFilter.onRendered(function () {
  $('[data-toggle=popover]').popover();
  const data = Template.currentData()

  /* clear moduleDetailFilter */
  Session.set('moduleDetailFilter');
  Session.set('moduleDetailFilterType');
  Session.set('moduleDetailConfidenceMinScore');
  Session.set('selectedLicenses');
  Session.set('selectedComponents');
  Session.set(IN_PROGRESS);
  Session.set('showAll');
  if (data.options && data.options.resetOnLoad) {
    Session.set('moduleDetailListFilter');
  }

  let router = Router.current();

  if (router.params.query.filter) {
    Session.set('moduleDetailListFilter', router.params.query.filter);
  }
  if (router.params.query.sorting) {
    Session.set('moduleDetailListSorting', router.params.query.sorting);
  }
  if (router.params.query.confidence) {
    Session.set('moduleDetailConfidenceMinScore', router.params.query.confidence);
  }
});

Template.moduleListFilter.events({
  'change input[name="search"]': _.throttle(evt => {
    let text = $(evt.target).val().trim();
    let query = Router.current().params.query || {};
    query.filter = text;
    let newUrl = Router.current().route.path(Router.current().params, {query: query});
    Router.go(newUrl);
    Session.set('moduleDetailListFilter', text);
    Session.set('pageListNumber',1);
  }, 300),
  'click .sorting': function () {
    let sorting = Session.get('moduleDetailListSorting');
    let query = Router.current().params.query;
    if (!sorting) {
      _.extend(query, {sorting: 'desc'});
      Session.set('moduleDetailListSorting', 'desc');
    } else {
      delete query.sorting;
      Session.set('moduleDetailListSorting');
    }
    let newUrl = Router.current().route.path(Router.current().params, {query: query});
    Router.go(newUrl);
  },
  'click .set-filter-type': function (event) {
    event.preventDefault();
    const type = $(event.currentTarget).data('type');
    Session.set('moduleDetailFilterType', type || undefined);
  },
  'click .rest-filters': function () {
    Session.set('moduleDetailListSorting');
    Session.set('moduleDetailListFilter');
    Session.set('moduleDetailFilter');
    let query = Router.current().params.query || {};
    delete query.filter;
    let newUrl = Router.current().route.path(Router.current().params, {query: query});
    Router.go(newUrl);
  },
  'click .mark-selected-all': function (event) {
    Session.set(IN_PROGRESS, true);
    const currentState = Router.current().route.getName();
    if (currentState === 'moduleLicenses') {
      toggleAll(event, 'licenses');
    } else if (currentState === 'moduleComponents') {
      toggleAll(event, 'components');
    } else if (currentState === 'moduleDependencies') {
      toggleAll(event, 'components');
    }
    Session.set(IN_PROGRESS);
  },
  'click .mark-selected-unchanged': function () {
    Session.set(IN_PROGRESS, true);
    let user = Meteor.user();
    if (Roles.userIsInRole(user, 'manager',user.profile.companyId)) {
      let module = Template.parentData();
      if(!module || (module && !module.moduleIdentifier)){
        module = Modules.findOne({_id: Router.current().params.moduleId});
      }
      let arr = module.getUnchangedComponents();
      const originalData = _.clone(arr);
      _.each(Session.get('selectedComponents'), function (componentKey) {
        arr.push({key: componentKey, version: '*', comment: 'added by component checkbox'});
      });
      Meteor.callAsync('updateCollection', 'Modules', module._id, 'componentConfig.unchanged', arr, true, originalData);
    }else{
      Notify.danger(NOT_ALLOWED);
    }
    Session.set(IN_PROGRESS);
    resetActions()
  },
  'click .mark-selected-loosecoupled': function () {
    Session.set(IN_PROGRESS, true);
    let user = Meteor.user();
    if (Roles.userIsInRole(user, 'manager',user.profile.companyId)) {
      let module = Template.parentData();
      if(!module || (module && !module.moduleIdentifier)){
        module = Modules.findOne({_id: Router.current().params.moduleId});
      }
      let arr = module.getLooseCoupledComponents();
      const originalData = _.clone(arr);
      _.each(Session.get('selectedComponents'), function (componentKey) {
        arr.push({key: componentKey, version: '*', comment: 'added by component checkbox'});
      });
      Meteor.callAsync('updateCollection', 'Modules', module._id, 'componentConfig.looseCoupled', arr, true, originalData);
    }else{
      Notify.danger(NOT_ALLOWED);
    }
    Session.set(IN_PROGRESS);
    resetActions()
  },
  'click .mark-selected-module-whitelisted': function () {
    Session.set(IN_PROGRESS, true);
    const user = Meteor.user();
    if (Roles.userIsInRole(user, 'manager',user.profile.companyId)) {
      const currentState = Router.current().route.getName();
      const now = new Date();
      let module = Template.parentData();
      if(!module || (module && !module.moduleIdentifier)){
        module = Modules.findOne({_id: Router.current().params.moduleId});
      }
      const comment = ADDED_BY + ((user.profile && user.profile.name)
        || (user.emails && user.emails[0] && user.emails[0].address || user.profile.email))
        + ', ' + now.toLocaleDateString();
      if (currentState === 'moduleLicenses') {
        let arr = module.getWhitelistedLicenses();
        const originalData = _.clone(arr);
        _.each(Session.get('selectedLicenses'), function (licenseKey) {
          arr.push({key: licenseKey, comment: comment});
        });
        Meteor.callAsync('updateCollection', 'Modules', module._id, LICENSES_WHITE, arr, true, originalData);
      } else if (currentState === 'moduleComponents') {
        let arr = module.getWhitelistedComponents();
        const originalData = _.clone(arr);
        _.each(Session.get('selectedComponents'), function (componentKey) {
          arr.push({key: componentKey, version: '*', comment: comment});
        });
        Meteor.callAsync('updateCollection', 'Modules', module._id, COMPONENTS_WHITE, arr, true, originalData);
      } else if (currentState === 'moduleDependencies') {
        let arr = module.getWhitelistedComponents();
        const originalData = _.clone(arr);
        _.each(Session.get('selectedComponents'), function (componentKey) {
          arr.push({key: componentKey, version: '*', comment: comment});
        });
        Meteor.callAsync('updateCollection', 'Modules', module._id, COMPONENTS_WHITE, arr, true, originalData);
      }
    }else{
      Notify.danger(NOT_ALLOWED);
    }
    Session.set(IN_PROGRESS);
    resetActions()
  },
  'click .unmark-selected-module-whitelisted': function () {
    Session.set(IN_PROGRESS, true);
    const user = Meteor.user();
    if (Roles.userIsInRole(user, 'manager',user.profile.companyId)) {
      const currentState = Router.current().route.getName();
      let module = Template.parentData();
      if(!module || (module && !module.moduleIdentifier)){
        module = Modules.findOne({_id: Router.current().params.moduleId});
      }
      if (currentState === 'moduleLicenses') {
        const arr = module.getWhitelistedLicenses();
        const originalData = _.clone(arr);
        let filteredArr = _.reject(arr, function (e) {
          return _.contains(Session.get('selectedLicenses'), e.key);
        });
        if (arr.length !== filteredArr.length) {
          Meteor.callAsync('updateCollection', 'Modules', module._id, LICENSES_WHITE, filteredArr, true, originalData);
        }
      } else if (currentState === 'moduleComponents') {
        const arr = module.getWhitelistedComponents();
        const originalData = _.clone(arr);
        let filteredArr = _.reject(arr, function (e) {
          return _.contains(Session.get('selectedComponents'), e.key);
        });
        if (arr.length !== filteredArr.length) {
          Meteor.callAsync('updateCollection', 'Modules', module._id, COMPONENTS_WHITE, filteredArr, true, originalData);
        }
      } else if (currentState === 'moduleDependencies') {
        const arr = module.getWhitelistedComponents();
        const originalData = _.clone(arr);
        let filteredArr = _.reject(arr, function (e) {
          return _.contains(Session.get('selectedComponents'), e.key);
        });
        if (arr.length !== filteredArr.length) {
          Meteor.callAsync('updateCollection', 'Modules', module._id, COMPONENTS_WHITE, filteredArr, true, originalData);
        }
      }
    }else{
      Notify.danger(NOT_ALLOWED);
    }
    Session.set(IN_PROGRESS);
    resetActions()
  },
  'click .mark-selected-project-whitelisted': function () {
    Session.set(IN_PROGRESS, true);
    const user = Meteor.user();
    if (Roles.userIsInRole(user, 'manager',user.profile.companyId)) {
      const currentState = Router.current().route.getName();
      const now = new Date();
      let module = Template.parentData();
      if(!module || (module && !module.moduleIdentifier)){
        module = Modules.findOne({_id: Router.current().params.moduleId});
      }
      const project = Projects.findOne(module.projectId);
      const comment = ADDED_BY + ((user.profile && user.profile.name)
        || (user.emails && user.emails[0] && user.emails[0].address || user.profile.email))
        + ', ' + now.toLocaleDateString();
      if (currentState === 'moduleLicenses') {
        let arr = project.getWhitelistedLicenses();
        const originalData = _.clone(arr);
        _.each(Session.get('selectedLicenses'), function (licenseKey) {
          arr.push({key: licenseKey, comment: comment});
        });
        Meteor.callAsync('updateCollection', 'Projects', project._id, LICENSES_WHITE, arr, true, originalData);
      } else if (currentState === 'moduleComponents') {
        let arr = project.getWhitelistedComponents();
        const originalData = _.clone(arr);
        _.each(Session.get('selectedComponents'), function (componentKey) {
          arr.push({key: componentKey, version: '*', comment: comment});
        });
        Meteor.callAsync('updateCollection', 'Projects', project._id, COMPONENTS_WHITE, arr, true, originalData);
      } else if (currentState === 'moduleDependencies') {
        let arr = project.getWhitelistedComponents();
        const originalData = _.clone(arr);
        _.each(Session.get('selectedComponents'), function (componentKey) {
          arr.push({key: componentKey, version: '*', comment: comment});
        });
        Meteor.callAsync('updateCollection', 'Projects', project._id, COMPONENTS_WHITE, arr, true, originalData);
      }
    }else{
      Notify.danger(NOT_ALLOWED);
    }
    Session.set(IN_PROGRESS);
    resetActions()
  },
  'click .unmark-selected-project-whitelisted': function () {
    Session.set(IN_PROGRESS, true);
    const user = Meteor.user();
    if (Roles.userIsInRole(user, 'manager',user.profile.companyId)) {
      const currentState = Router.current().route.getName();
      let module = Template.parentData();
      if(!module || (module && !module.moduleIdentifier)){
        module = Modules.findOne({_id: Router.current().params.moduleId});
      }
      const project = Projects.findOne(module.projectId);
      if (currentState === 'moduleLicenses') {
        const arr = project.getWhitelistedLicenses();
        const originalData = _.clone(arr);
        let filteredArr = _.reject(arr, function (e) {
          return _.contains(Session.get('selectedLicenses'), e.key);
        });
        if (arr.length !== filteredArr.length) {
          Meteor.callAsync('updateCollection', 'Projects', project._id, LICENSES_WHITE, filteredArr, true, originalData);
        }
      } else if (currentState === 'moduleComponents') {
        const arr = project.getWhitelistedComponents();
        const originalData = _.clone(arr);
        let filteredArr = _.reject(arr, function (e) {
          return _.contains(Session.get('selectedComponents'), e.key);
        });
        if (arr.length !== filteredArr.length) {
          Meteor.callAsync('updateCollection', 'Projects', project._id, COMPONENTS_WHITE, filteredArr, true, originalData);
        }
      } else if (currentState === 'moduleDependencies') {
        const arr = project.getWhitelistedComponents();
        const originalData = _.clone(arr);
        let filteredArr = _.reject(arr, function (e) {
          return _.contains(Session.get('selectedComponents'), e.key);
        });
        if (arr.length !== filteredArr.length) {
          Meteor.callAsync('updateCollection', 'Projects', project._id, COMPONENTS_WHITE, filteredArr, true, originalData);
        }
      }
    }else{
      Notify.danger(NOT_ALLOWED);
    }
    Session.set(IN_PROGRESS);
    resetActions()
  },
  'click .mark-selected-company-whitelisted': function () {
    Session.set(IN_PROGRESS, true);
    const user = Meteor.user();
    if (Roles.userIsInRole(user, 'manager',user.profile.companyId)) {
      const currentState = Router.current().route.getName();
      const now = new Date();
      const company = Session.get('company');
      const comment = ADDED_BY + ((user.profile && user.profile.name)
        || (user.emails && user.emails[0] && user.emails[0].address || user.profile.email))
        + ', ' + now.toLocaleDateString();
      if (currentState === 'moduleLicenses') {
        let arr = company.licenseConfig && company.licenseConfig.whitelist || [];
        const originalData = _.clone(arr);
        _.each(Session.get('selectedLicenses'), function (licenseKey) {
          arr.push({key: licenseKey, comment: comment});
        });
        Meteor.callAsync('updateCollection', 'Companies', company._id, LICENSES_WHITE, arr, true, originalData);
      } else if (currentState === 'moduleComponents') {
        let arr = company.componentConfig && company.componentConfig.whitelist || [];
        const originalData = _.clone(arr);
        _.each(Session.get('selectedComponents'), function (componentKey) {
          arr.push({key: componentKey, version: '*', comment: comment});
        });
        Meteor.callAsync('updateCollection', 'Companies', company._id, COMPONENTS_WHITE, arr, true, originalData);
      } else if (currentState === 'moduleDependencies') {
        let arr = company.componentConfig && company.componentConfig.whitelist || [];
        const originalData = _.clone(arr);
        _.each(Session.get('selectedComponents'), function (componentKey) {
          arr.push({key: componentKey, version: '*', comment: comment});
        });
        Meteor.callAsync('updateCollection', 'Companies', company._id, COMPONENTS_WHITE, arr, true, originalData);
      }
    }else{
      Notify.danger(NOT_ALLOWED);
    }
    Session.set(IN_PROGRESS);
    resetActions()
  },
  'click .unmark-selected-company-whitelisted': function () {
    Session.set(IN_PROGRESS, true);
    const user = Meteor.user();
    if (Roles.userIsInRole(user, 'manager',user.profile.companyId)) {
      const currentState = Router.current().route.getName();
      const company = Session.get('company');
      if (currentState === 'moduleLicenses') {
        const arr = company.licenseConfig && company.licenseConfig.whitelist;
        const originalData = _.clone(arr);
        let filteredArr = _.reject(arr, function (e) {
          return _.contains(Session.get('selectedLicenses'), e.key);
        });
        if (arr.length !== filteredArr.length) {
          Meteor.callAsync('updateCollection', 'Companies', company._id, LICENSES_WHITE, filteredArr, true, originalData);
        }
      } else if (currentState === 'moduleComponents') {
        const arr = company.componentConfig && company.componentConfig.whitelist;
        const originalData = _.clone(arr);
        let filteredArr = _.reject(arr, function (e) {
          return _.contains(Session.get('selectedComponents'), e.key);
        });
        if (arr.length !== filteredArr.length) {
          Meteor.callAsync('updateCollection', 'Companies', company._id, COMPONENTS_WHITE, filteredArr, true, originalData);
        }
      } else if (currentState === 'moduleDependencies') {
        const arr = company.componentConfig && company.componentConfig.whitelist;
        const originalData = _.clone(arr);
        let filteredArr = _.reject(arr, function (e) {
          return _.contains(Session.get('selectedComponents'), e.key);
        });
        if (arr.length !== filteredArr.length) {
          Meteor.callAsync('updateCollection', 'Companies', company._id, COMPONENTS_WHITE, filteredArr, true, originalData);
        }
      }
    }else{
      Notify.danger(NOT_ALLOWED);
    }
    Session.set(IN_PROGRESS);
    resetActions()
  },
  'click .mark-selected-module-blacklisted': function () {
    Session.set(IN_PROGRESS, true);
    const user = Meteor.user();
    if (Roles.userIsInRole(user, 'manager',user.profile.companyId)) {
      const currentState = Router.current().route.getName();
      const now = new Date();
      let module = Template.parentData();
      if(!module || (module && !module.moduleIdentifier)){
        module = Modules.findOne({_id: Router.current().params.moduleId});
      }
      const comment = ADDED_BY + ((user.profile && user.profile.name)
        || (user.emails && user.emails[0] && user.emails[0].address || user.profile.email))
        + ', ' + now.toLocaleDateString();
      if (currentState === 'moduleLicenses') {
        let arr = module.getBlacklistedLicenses();
        const originalData = _.clone(arr);
        _.each(Session.get('selectedLicenses'), function (licenseKey) {
          arr.push({key: licenseKey, comment: comment});
        });
        Meteor.callAsync('updateCollection', 'Modules', module._id, LICENSES_BLACK, arr, true, originalData);
      } else if (currentState === 'moduleComponents') {
        let arr = module.getBlacklistedComponents();
        const originalData = _.clone(arr);
        _.each(Session.get('selectedComponents'), function (componentKey) {
          arr.push({key: componentKey, version: '*', comment: comment});
        });
        Meteor.callAsync('updateCollection', 'Modules', module._id, COMPONENTS_BLACK, arr, true, originalData);
      } else if (currentState === 'moduleDependencies') {
        let arr = module.getBlacklistedComponents();
        const originalData = _.clone(arr);
        _.each(Session.get('selectedComponents'), function (componentKey) {
          arr.push({key: componentKey, version: '*', comment: comment});
        });
        Meteor.callAsync('updateCollection', 'Modules', module._id, COMPONENTS_BLACK, arr, true, originalData);
      }
    }else{
      Notify.danger(NOT_ALLOWED);
    }
    Session.set(IN_PROGRESS);
    resetActions()
  },
  'click .unmark-selected-module-blacklisted': function () {
    Session.set(IN_PROGRESS, true);
    const user = Meteor.user();
    if (Roles.userIsInRole(user, 'manager',user.profile.companyId)) {
      const currentState = Router.current().route.getName();
      let module = Template.parentData();
      if(!module || (module && !module.moduleIdentifier)){
        module = Modules.findOne({_id: Router.current().params.moduleId});
      }
      if (currentState === 'moduleLicenses') {
        const arr = module.getBlacklistedLicenses();
        const originalData = _.clone(arr);
        let filteredArr = _.reject(arr, function (e) {
          return _.contains(Session.get('selectedLicenses'), e.key);
        });
        if (arr.length !== filteredArr.length) {
          Meteor.callAsync('updateCollection', 'Modules', module._id, LICENSES_BLACK, filteredArr, true, originalData);
        }
      } else if (currentState === 'moduleComponents') {
        const arr = module.getBlacklistedComponents();
        const originalData = _.clone(arr);
        let filteredArr = _.reject(arr, function (e) {
          return _.contains(Session.get('selectedComponents'), e.key);
        });
        if (arr.length !== filteredArr.length) {
          Meteor.callAsync('updateCollection', 'Modules', module._id, COMPONENTS_BLACK, filteredArr, true, originalData);
        }
      } else if (currentState === 'moduleDependencies') {
        const arr = module.getBlacklistedComponents();
        const originalData = _.clone(arr);
        let filteredArr = _.reject(arr, function (e) {
          return _.contains(Session.get('selectedComponents'), e.key);
        });
        if (arr.length !== filteredArr.length) {
          Meteor.callAsync('updateCollection', 'Modules', module._id, COMPONENTS_BLACK, filteredArr, true, originalData);
        }
      }
    }else{
      Notify.danger(NOT_ALLOWED);
    }
    Session.set(IN_PROGRESS);
    resetActions()
  },
  'click .mark-selected-project-blacklisted': function () {
    Session.set(IN_PROGRESS, true);
    const user = Meteor.user();
    if (Roles.userIsInRole(user, 'manager',user.profile.companyId)) {
      const currentState = Router.current().route.getName();
      const now = new Date();
      let module = Template.parentData();
      if(!module || (module && !module.moduleIdentifier)){
        module = Modules.findOne({_id: Router.current().params.moduleId});
      }
      const project = Projects.findOne(module.projectId);
      const comment = ADDED_BY + ((user.profile && user.profile.name)
        || (user.emails && user.emails[0] && user.emails[0].address || user.profile.email))
        + ', ' + now.toLocaleDateString();
      if (currentState === 'moduleLicenses') {
        let arr = project.getBlacklistedLicenses();
        const originalData = _.clone(arr);
        _.each(Session.get('selectedLicenses'), function (licenseKey) {
          arr.push({key: licenseKey, comment: comment});
        });
        Meteor.callAsync('updateCollection', 'Projects', project._id, LICENSES_BLACK, arr, true, originalData);
      } else if (currentState === 'moduleComponents') {
        let arr = project.getBlacklistedComponents();
        const originalData = _.clone(arr);
        _.each(Session.get('selectedComponents'), function (componentKey) {
          arr.push({key: componentKey, version: '*', comment: comment});
        });
        Meteor.callAsync('updateCollection', 'Projects', project._id, COMPONENTS_BLACK, arr, true, originalData);
      } else if (currentState === 'moduleDependencies') {
        let arr = project.getBlacklistedComponents();
        const originalData = _.clone(arr);
        _.each(Session.get('selectedComponents'), function (componentKey) {
          arr.push({key: componentKey, version: '*', comment: comment});
        });
        Meteor.callAsync('updateCollection', 'Projects', project._id, COMPONENTS_BLACK, arr, true, originalData);
      }
    }else{
      Notify.danger(NOT_ALLOWED);
    }
    Session.set(IN_PROGRESS);
    resetActions()
  },
  'click .unmark-selected-project-blacklisted': function () {
    Session.set(IN_PROGRESS, true);
    const user = Meteor.user();
    if (Roles.userIsInRole(user, 'manager',user.profile.companyId)) {
      const currentState = Router.current().route.getName();
      let module = Template.parentData();
      if(!module || (module && !module.moduleIdentifier)){
        module = Modules.findOne({_id: Router.current().params.moduleId});
      }
      const project = Projects.findOne(module.projectId);
      if (currentState === 'moduleLicenses') {
        const arr = project.getBlacklistedLicenses();
        const originalData = _.clone(arr);
        let filteredArr = _.reject(arr, function (e) {
          return _.contains(Session.get('selectedLicenses'), e.key);
        });
        if (arr.length !== filteredArr.length) {
          Meteor.callAsync('updateCollection', 'Projects', project._id, LICENSES_BLACK, filteredArr, true, originalData);
        }
      } else if (currentState === 'moduleComponents') {
        const arr = project.getBlacklistedComponents();
        const originalData = _.clone(arr);
        let filteredArr = _.reject(arr, function (e) {
          return _.contains(Session.get('selectedComponents'), e.key);
        });
        if (arr.length !== filteredArr.length) {
          Meteor.callAsync('updateCollection', 'Projects', project._id, COMPONENTS_BLACK, filteredArr, true, originalData);
        }
      } else if (currentState === 'moduleDependencies') {
        const arr = project.getBlacklistedComponents();
        const originalData = _.clone(arr);
        let filteredArr = _.reject(arr, function (e) {
          return _.contains(Session.get('selectedComponents'), e.key);
        });
        if (arr.length !== filteredArr.length) {
          Meteor.callAsync('updateCollection', 'Projects', project._id, COMPONENTS_BLACK, filteredArr, true, originalData);
        }
      }
    }else{
      Notify.danger(NOT_ALLOWED);
    }
    Session.set(IN_PROGRESS);
    resetActions()
  },
  'click .mark-selected-company-blacklisted': function () {
    Session.set(IN_PROGRESS, true);
    const user = Meteor.user();
    if (Roles.userIsInRole(user, 'manager',user.profile.companyId)) {
      const currentState = Router.current().route.getName();
      const now = new Date();
      const company = Session.get('company');
      const comment = ADDED_BY + ((user.profile && user.profile.name)
        || (user.emails && user.emails[0] && user.emails[0].address || user.profile.email))
        + ', ' + now.toLocaleDateString();
      if (currentState === 'moduleLicenses') {
        let arr = company.licenseConfig && company.licenseConfig.blacklist || [];
        const originalData = _.clone(arr);
        _.each(Session.get('selectedLicenses'), function (licenseKey) {
          arr.push({key: licenseKey, comment: comment});
        });
        Meteor.callAsync('updateCollection', 'Companies', company._id, LICENSES_BLACK, arr, true, originalData);
      } else if (currentState === 'moduleComponents') {
        let arr = company.componentConfig && company.componentConfig.blacklist || [];
        const originalData = _.clone(arr);
        _.each(Session.get('selectedComponents'), function (componentKey) {
          arr.push({key: componentKey, version: '*', comment: comment});
        });
        Meteor.callAsync('updateCollection', 'Companies', company._id, COMPONENTS_BLACK, arr, true, originalData);
      } else if (currentState === 'moduleDependencies') {
        let arr = company.componentConfig && company.componentConfig.blacklist || [];
        const originalData = _.clone(arr);
        _.each(Session.get('selectedComponents'), function (componentKey) {
          arr.push({key: componentKey, version: '*', comment: comment});
        });
        Meteor.callAsync('updateCollection', 'Companies', company._id, COMPONENTS_BLACK, arr, true, originalData);
      }
    }else{
      Notify.danger(NOT_ALLOWED);
    }
    Session.set(IN_PROGRESS);
    resetActions()
  },
  'click .unmark-selected-company-blacklisted': function () {
    Session.set(IN_PROGRESS, true);
    const user = Meteor.user();
    if (Roles.userIsInRole(user, 'manager',user.profile.companyId)) {
      const currentState = Router.current().route.getName();
      const company = Session.get('company');
      if (currentState === 'moduleLicenses') {
        const arr = company.licenseConfig && company.licenseConfig.blacklist;
        const originalData = _.clone(arr);
        let filteredArr = _.reject(arr, function (e) {
          return _.contains(Session.get('selectedLicenses'), e.key);
        });
        if (arr.length !== filteredArr.length) {
          Meteor.callAsync('updateCollection', 'Companies', company._id, LICENSES_BLACK, filteredArr, true, originalData);
        }
      } else if (currentState === 'moduleComponents') {
        const arr = company.componentConfig && company.componentConfig.blacklist;
        const originalData = _.clone(arr);
        let filteredArr = _.reject(arr, function (e) {
          return _.contains(Session.get('selectedComponents'), e.key);
        });
        if (arr.length !== filteredArr.length) {
          Meteor.callAsync('updateCollection', 'Companies', company._id, COMPONENTS_BLACK, filteredArr, true, originalData);
        }
      } else if (currentState === 'moduleDependencies') {
        const arr = company.componentConfig && company.componentConfig.blacklist;
        const originalData = _.clone(arr);
        let filteredArr = _.reject(arr, function (e) {
          return _.contains(Session.get('selectedComponents'), e.key);
        });
        if (arr.length !== filteredArr.length) {
          Meteor.callAsync('updateCollection', 'Companies', company._id, COMPONENTS_BLACK, filteredArr, true, originalData);
        }
      }
    }else{
      Notify.danger(NOT_ALLOWED);
    }
    Session.set(IN_PROGRESS);
    resetActions()
  },
  'click .toggle-list-view': function (event) {
    Session.set(IN_PROGRESS, true);
    event.preventDefault();
    let panelEl = $(event.target).closest('.ts-panel');
    let actions = $(event.target).closest('.actions').find('.toggle-list-view');
    let icon = panelEl.find('.expand-table').find('i.ts-panel-toggle');
    let body = panelEl.find('.table-collapse, .description');
    if ($(event.target).closest('.actions').find('.hidden').hasClass('collapse-all')) {
      Session.set('showAll',true);
      Meteor.setTimeout(function () {
        const bodyComponent = panelEl.find('.component-table-collapse');
        bodyComponent.slideDown(0);
        body.slideDown(300);
        panelEl.removeClass('collapsed');
        icon.toggleClass('fa-chevron-right fa-chevron-down');
      },100);
    } else {
      Session.set('showAll');
      Meteor.setTimeout(function () {
        const bodyComponent = panelEl.find('.component-table-collapse');
        bodyComponent.slideUp(0);
        body.slideUp(300);
        panelEl.addClass('collapsed');
        icon.toggleClass('fa-chevron-down fa-chevron-right');
      },100);
    }
    actions.toggleClass('hidden');
    Session.set(IN_PROGRESS);
  },
  'click .change_confidence': function (event) {
    event.preventDefault();
    const value = $(event.target).attr('data-value');
    let query = Router.current().params.query || {};
    _.extend(query, {confidence: value});
    Session.set('moduleDetailConfidenceMinScore', value);
    let newUrl = Router.current().route.path(Router.current().params, {query: query});
    Router.go(newUrl);
  }
});

function toggleAll(event, selector) {
  let checkboxes = document.getElementsByName(selector);
  for (let i = 0, n = checkboxes.length; i < n; i++) {
    checkboxes[i].checked = event.target.checked;
  }
  const content = $(event.target).closest('.content');
  let items = [];
  content.find('input[name=' + selector + ']:checked').each(function () {
    items.push(this.value);
  });
  Session.set('selected' + toTitleCase(selector), items);

}

function toTitleCase(str) {
  return str.replace(/\w\S*/g, function (txt) {
    return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();
  });
}

Template.moduleListFilter.helpers({
  selectAllPossible: function () {
    const allowedStates = ['moduleDetail', 'moduleLicenses', 'moduleComponents', 'moduleDependencies'];
    return (allowedStates.indexOf(Router.current().route.getName()) > -1)
  },
  selectActionsDisabled: function () {
    const currentState = Router.current().route.getName();
    let list = [];
    if (currentState === 'moduleLicenses') {
      list = Session.get('selectedLicenses')
    } else if (currentState === 'moduleComponents') {
      list = Session.get('selectedComponents')
    } else if (currentState === 'moduleDependencies') {
      list = Session.get('selectedComponents')
    }
    return Session.get(IN_PROGRESS) || (!list || list.length < 1)
  },
  isComponentStates: function () {
    const allowedStates = ['moduleComponents', 'moduleDependencies'];
    return (allowedStates.indexOf(Router.current().route.getName()) > -1)
  },

  isDescSorting: function () {
    const filter = Session.get('moduleDetailListSorting');
    return filter || false;
  },

  isProjectAvailable: function () {
    let module = Template.parentData();
    if(!module || (module && !module.moduleIdentifier)){
      module = Modules.findOne({_id: Router.current().params.moduleId});
    }
    return module && module.projectId
  },

  isCompanyAvailable: function () {
    const user = Meteor.user();
    return user && user.profile && user.profile.companyId
  },
  layoutDependency:function () {
    const options = this.options;
    return options && options.layoutDependency
  },
  treeView:function () {
    const options = this.options;
    return options && options.treeView
  },
  isFilterType: function (type) {
    const filterType = Session.get('moduleDetailFilterType');
    return filterType === type
  },
  getFilterType: function () {
    const filterType = Session.get('moduleDetailFilterType');
    return filterType ? filterType : 'overall'
  },
  getFilterTypeValue: function () {
    return Session.get('moduleDetailFilterType');
  },
  confidenceVariants: function () {
    return confidenceVariants
  },
  confidenceCurrent: function () {
    const list = confidenceVariants
    let module = Template.parentData();
    if(!module || (module && !module.moduleIdentifier)){
      module = Modules.findOne({_id: Router.current().params.moduleId});
    }
    const project = module && module.projectId ? Projects.findOne(module.projectId) : null;
    let current = Session.get('moduleDetailConfidenceMinScore');
    if(!current){
      current = Utils.resolveConfidenceMinScore(module, project, '3')
      Session.set('moduleDetailConfidenceMinScore', current)
    }
    const item = list.find((score) => {
      return score.value == current
    })
    return item && item.label
  }
});

const confidenceVariants = [{
  value: '5',
  label: 'High only'
},{
  value: '4',
  label: 'Medium +'
},{
  value: '1',
  label: 'All'
}]
