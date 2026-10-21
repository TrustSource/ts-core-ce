import {Template} from 'meteor/templating';
import {Meteor} from 'meteor/meteor';
import {Session} from 'meteor/session';
import _ from 'underscore';
import {$} from 'meteor/jquery';
import Projects from '/imports/lib/collections/projects';
import Modules from '/imports/lib/collections/modules';
import Notify from '/imports/api/notify';
import {BWObligationEntrySchema} from '/imports/lib/schemas/bwlistSchema';

const UPDATE_PROBLEM = 'Update problem: '

Template.moduleSettingsObligations.onRendered(function () {
  Session.set('importFilter');
  Session.set('moduleFilter');
});

Template.moduleSettingsObligations.events({

  'click .copy-obligation-settings': function (event) {
    event.preventDefault();
    let moduleParent = Template.parentData();
    let moduleCurrent = Template.currentData();
    const module = moduleCurrent && moduleCurrent.moduleIdentifier ? moduleCurrent : moduleParent;
    const src = Modules.findOne({_id: event.target.id}, {fields: {name: 1, obligationConfig: 1}});
    if (src) {
      Meteor.callAsync('Modules.UpdateObligationConfig', module._id, src.obligationConfig).then(function () {
        Notify.success('Obligations settings copied from: ' + (src.name));
      }).catch(function (error) {
        console.log(UPDATE_PROBLEM, error);
      });
    }
  },
  'click .propagate-all-obligation-settings': function (event) {
    event.preventDefault();
    let moduleParent = Template.parentData();
    let moduleCurrent = Template.currentData();
    const module = moduleCurrent && moduleCurrent.moduleIdentifier ? moduleCurrent : moduleParent;
    if (module) {
      Meteor.callAsync('bulkUpdateModuleObligationSettings', module._id, module.obligationConfig).then(function() {
        Notify.success('Obligations settings propagated to all modules');
      }).catch(function(error) {
        if (error) {
          console.log(UPDATE_PROBLEM, error);
        }
      });
    }
  },
  'click .propagate-all-my-obligation-settings': function (event) {
    event.preventDefault();
    let moduleParent = Template.parentData();
    let moduleCurrent = Template.currentData();
    const module = moduleCurrent && moduleCurrent.moduleIdentifier ? moduleCurrent : moduleParent;
    if (module) {
      Meteor.callAsync(
        'bulkUpdateMyModuleObligationSettings',
        module._id,
        module.obligationConfig
      ).then(function() {
        Notify.success('Obligations settings propagated to all modules');
      }).catch(function(error) {
        if (error) {
          console.log(UPDATE_PROBLEM, error);
        }
      });
    }
  },
  'click .propagate-project-obligation-settings': function (event) {
    event.preventDefault();
    let moduleParent = Template.parentData();
    let moduleCurrent = Template.currentData();
    const module = moduleCurrent && moduleCurrent.moduleIdentifier ? moduleCurrent : moduleParent;
    if (module) {
      Meteor.callAsync(
        'bulkUpdateProjectModuleObligationSettings',
        module._id,
        module.projectId,
        module.obligationConfig
      ).then(function() {
        Notify.success('Obligations settings propagated to all project modules');
      }).catch(function(error) {
        if (error) {
          console.log(UPDATE_PROBLEM, error);
        }
      });
    }
  },
  'click .propagate-my-project-legal-settings': function (event) {
    event.preventDefault();
    let moduleParent = Template.parentData();
    let moduleCurrent = Template.currentData();
    const module = moduleCurrent && moduleCurrent.moduleIdentifier ? moduleCurrent : moduleParent;
    if (module) {
      Meteor.callAsync(
        'bulkUpdateMyProjectModuleObligationSettings',
        module._id,
        module.projectId,
        module.obligationConfig
      ).then(function() {
        Notify.success('Obligations settings propagated to all my project modules');
      }).catch(function(error) {
        if (error) {
          console.log(UPDATE_PROBLEM, error);
        }
      });
    }
  },
  'click .propagate-obligation-settings': function (event) {
    event.preventDefault();
    let moduleParent = Template.parentData();
    let moduleCurrent = Template.currentData();
    const module = moduleCurrent && moduleCurrent.moduleIdentifier ? moduleCurrent : moduleParent;
    if (module) {
      Meteor.callAsync('Modules.UpdateObligationConfig', event.target.id, module.obligationConfig).then(function () {
        Notify.success('Obligations settings propagated to module');
      }).catch(function (error) {
        console.log(UPDATE_PROBLEM, error);
      });
    }
  },
  'input .import_filter': function (event) {
    Session.set('importFilter', $(event.target).val())
  },
  'input .module_filter': function (event) {
    Session.set('moduleFilter', $(event.target).val())
  }
});

Template.moduleSettingsObligations.helpers({
  currentModule: function () {
    let moduleParent = Template.parentData();
    let moduleCurrent = Template.currentData();
    return moduleCurrent && moduleCurrent.moduleIdentifier ? moduleCurrent : moduleParent
  },

  getObligationSettings: function () {
    let moduleParent = Template.parentData();
    let moduleCurrent = Template.currentData();
    const module = moduleCurrent && moduleCurrent.moduleIdentifier ? moduleCurrent : moduleParent;
    return Modules.find(
      {_id: {$ne: module._id}, obligationConfig: {$exists: true}, name: {$exists: true}}).fetch();
  },

  getProjects() {
    return Projects;
  },

  getModules() {
    return Modules;
  },

  otherModules: function () {
    const user = Meteor.user();
    const companyId = user.profile.companyId;
    return Modules.find({
      $and: [
        {_id: {$ne: this._id}},
        { companyId: companyId },
        { name: {$exists: true}},
        { $or: [
          {'relatedUsers': { $exists: false }},
          {'relatedUsers.members': { $exists: false }},
          {'relatedUsers.members': []},
          {'relatedUsers.members': user._id},
          {'relatedUsers.defaultProjectManager': user._id},
          {'relatedUsers.defaultComplianceManager': user._id}
        ]}
      ]}).fetch()
  },

  myModulesCount: function () {
    const user = Meteor.user();
    const companyId = user.profile.companyId;
    return Modules.find({
      $and: [
        {_id: {$ne: this._id}},
        { companyId: companyId },
        { name: {$exists: true}},
        { $or: [
          {'relatedUsers.defaultProjectManager': user._id},
          {'relatedUsers.defaultComplianceManager': user._id}
        ]}
      ]}).count()
  },

  projectModulesCount: function () {
    const user = Meteor.user();
    const companyId = user.profile.companyId;
    const module = Template.currentData();
    return Modules.find({
      $and: [
        {_id: {$ne: module._id}},
        { projectId: module.projectId },
        { companyId: companyId },
        { name: {$exists: true}},
        { $or: [
          {'relatedUsers': { $exists: false }},
          {'relatedUsers.members': { $exists: false }},
          {'relatedUsers.members': []},
          {'relatedUsers.members': user._id},
          {'relatedUsers.defaultProjectManager': user._id},
          {'relatedUsers.defaultComplianceManager': user._id}
        ]}
      ]}).count()
  },

  myProjectModulesCount: function () {
    const user = Meteor.user();
    const companyId = user.profile.companyId;
    const module = Template.currentData();
    return Modules.find({
      $and: [
        {_id: {$ne: module._id}},
        { projectId: module.projectId },
        { companyId: companyId },
        { name: {$exists: true}},
        { $or: [
          {'relatedUsers.defaultProjectManager': user._id},
          {'relatedUsers.defaultComplianceManager': user._id}
        ]}
      ]}).count()
  },

  myProjects: function () {
    let moduleParent = Template.parentData();
    let moduleCurrent = Template.currentData();
    const module = moduleCurrent && moduleCurrent.moduleIdentifier ? moduleCurrent : moduleParent;
    const user = Meteor.user();
    const companyId = user.profile.companyId;
    return Projects.find({
      $and: [
        {_id: {$ne: module.projectId}},
        { companyId: companyId },
        { name: {$exists: true}},
        { $or: [
          {'relatedUsers.defaultProjectManager': user._id},
          {'relatedUsers.defaultComplianceManager': user._id}
        ]}
      ]}).fetch()
  },

  filterList: function (list, filter) {
    return _.filter(list, m => {
      return m.getName().toLowerCase().indexOf(filter.toLowerCase()) > -1
    }).slice(0, 9);
  },

  getImportFilter: function () {
    return Session.get('importFilter') || '';
  },

  getProjectFilter: function () {
    return Session.get('projectFilter') || '';
  },

  getProject: function () {
    let moduleParent = Template.parentData();
    let moduleCurrent = Template.currentData();
    const module = moduleCurrent && moduleCurrent.moduleIdentifier ? moduleCurrent : moduleParent;
    return module && Projects.findOne(module.projectId);
  },

  getProjectObligationConfig: function () {
    let moduleParent = Template.parentData();
    let moduleCurrent = Template.currentData();
    const module = moduleCurrent && moduleCurrent.moduleIdentifier ? moduleCurrent : moduleParent;
    const project = module && Projects.findOne(module.projectId);
    return project && project.obligationConfig || {};
  },

  noProjectObligationConfig: function () {
    let moduleParent = Template.parentData();
    let moduleCurrent = Template.currentData();
    const module = moduleCurrent && moduleCurrent.moduleIdentifier ? moduleCurrent : moduleParent;
    const project = module && Projects.findOne(module.projectId);
    return project && (!project.obligationConfig || Object.keys(project.obligationConfig).length === 0);
  },

  getObligation: function () {
    let moduleParent = Template.parentData();
    let moduleCurrent = Template.currentData();
    const module = moduleCurrent && moduleCurrent.moduleIdentifier ? moduleCurrent : moduleParent;
    return module && module.obligationConfig || [];
  },

  getList() {
    return Projects;
  },

  getObligationSchema() {
    return BWObligationEntrySchema;
  },

  getProjectRouteName: function () {
    return 'projectSettings'
  },

  getProjectRouteOptions: function () {
    let moduleParent = Template.parentData();
    let moduleCurrent = Template.currentData();
    const module = moduleCurrent && moduleCurrent.moduleIdentifier ? moduleCurrent : moduleParent;
    return {
      projectId: module.projectId
    }
  }

});
