import {Template} from 'meteor/templating';
import {Meteor} from 'meteor/meteor';
import {Session} from 'meteor/session';
import _ from 'underscore';
import {$} from 'meteor/jquery';
import Projects from '/imports/lib/collections/projects';
import Notify from '/imports/api/notify';
import {BWObligationEntrySchema} from '/imports/lib/schemas/bwlistSchema';

const UPDATE_PROBLEM = 'Update problem: '

Template.projectSettingsObligations.onRendered(function () {
  Session.set('importFilter');
  Session.set('moduleFilter');
});

Template.projectSettingsObligations.events({

  'click .copy-obligation-settings': function (event) {
    event.preventDefault();
    const module = Template.currentData();
    const src = Projects.findOne({_id: event.target.id}, {fields: {name: 1, obligationConfig: 1}});
    if (src) {
      Meteor.callAsync('Projects.UpdateObligationConfig', module._id, src.obligationConfig).then(function () {
        Notify.success('Obligations settings copied from: ' + (src.name));
      }).catch(function (error) {
        console.log(UPDATE_PROBLEM, error);
      });
    }
  },
  'click .propagate-all-obligation-settings': function (event) {
    event.preventDefault();
    const module = Template.currentData();
    if (module) {
      Meteor.callAsync('bulkUpdateProjectObligationSettings', module._id, module.obligationConfig).then(function() {
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
    const module = Template.currentData();
    if (module) {
      Meteor.callAsync(
        'bulkUpdateMyProjectObligationSettings',
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
    const module = Template.currentData();
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
  'click .propagate-obligation-settings': function (event) {
    event.preventDefault();
    const module = Template.currentData();
    if (module) {
      Meteor.callAsync('Projects.UpdateObligationConfig', event.target.id, module.obligationConfig).then(function () {
        Notify.success('Obligations settings propagated to project');
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

Template.projectSettingsObligations.helpers({
  currentProject: function () {
    let parent = Template.parentData();
    let current = Template.currentData();
    return current && current.moduleCount ? current : parent
  },

  getObligationSettings: function () {
    let parent = Template.parentData();
    let current = Template.currentData();
    const project = current && current.moduleCount ? current : parent
    return Projects.find(
      {_id: {$ne: project._id}, obligationConfig: {$exists: true}, name: {$exists: true}}).fetch();
  },

  getProjects() {
    return Projects;
  },

  otherProjects: function () {
    let parent = Template.parentData();
    let current = Template.currentData();
    const project = current && current.moduleCount ? current : parent
    const user = Meteor.user();
    const companyId = user.profile.companyId;
    return Projects.find({
      $and: [
        {_id: {$ne: project._id}},
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

  myProjects: function () {
    let parent = Template.parentData();
    let current = Template.currentData();
    const project = current && current.moduleCount ? current : parent
    const user = Meteor.user();
    const companyId = user.profile.companyId;
    return Projects.find({
      $and: [
        {_id: {$ne: project._id}},
        { companyId: companyId },
        { name: {$exists: true}},
        { $or: [
          {'relatedUsers.defaultProjectManager': user._id},
          {'relatedUsers.defaultComplianceManager': user._id}
        ]}
      ]}).fetch()
  },

  projectModulesCount: function () {
    const user = Meteor.user();
    const companyId = user.profile.companyId;
    const module = Template.currentData();
    return Projects.find({
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

  getObligation: function () {
    let parent = Template.parentData();
    let current = Template.currentData();
    const project = current && current.moduleCount ? current : parent
    return project.obligationConfig || {};
  },

  getList() {
    return Projects;
  },

  getObligationSchema() {
    return BWObligationEntrySchema;
  }

});
